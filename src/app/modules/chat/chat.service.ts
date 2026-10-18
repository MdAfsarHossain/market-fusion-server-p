import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { query, transaction } from "../../utils/db";
import { resolveStoreFor } from "../../utils/storeAccess";
import { enqueueNotifications } from "../../queues/notification.queue";
import { emitToConversation, emitToUser } from "../../lib/chatGateway";

const getVendorStore = async (userId: string) => {
  const access = await resolveStoreFor(userId, "CHAT");
  return access.store;
};

// Which side of a thread this user is on, and whether they belong in it at all.
//
// A store side participant may be the owner or any staff member with CHAT
// access, so membership is resolved rather than assumed.
const resolveParticipant = async (userId: string, conversationId: string) => {
  const result = await query(
    `
        SELECT
            c.*,
            s.owner_id,
            s.name as store_name,
            u.name as buyer_name
        FROM conversations c
        INNER JOIN stores s ON c.store_id = s.id
        INNER JOIN users u ON c.buyer_id = u.id
        WHERE c.id = $1::uuid
    `,
    [conversationId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Conversation not found.");
  }

  const conversation = result.rows[0];

  if (conversation.buyer_id === userId) {
    return { conversation, side: "BUYER" as const };
  }

  // Anyone who can act for the store can read and reply
  const staff = await query(
    `
        SELECT 1 FROM store_staff
        WHERE store_id = $1::uuid
            AND user_id = $2::uuid
            AND status = 'ACTIVE'::"StaffStatus"
            AND 'CHAT' = ANY(permissions)
    `,
    [conversation.store_id, userId],
  );

  if (conversation.owner_id === userId || staff.rows.length > 0) {
    return { conversation, side: "STORE" as const };
  }

  throw new ApiError(httpStatus.NOT_FOUND, "Conversation not found.");
};

// Start or reuse a thread with a store. Buyers open conversations, not stores,
// so a vendor cannot cold-message a customer.
const startConversation = async (userId: string, payload: any) => {
  const storeResult = await query(
    `
        SELECT id, name, slug, owner_id, status
        FROM stores WHERE id = $1::uuid
    `,
    [payload.store_id],
  );

  if (storeResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Store not found.");
  }

  const store = storeResult.rows[0];

  if (store.owner_id === userId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "You cannot start a conversation with your own store.",
    );
  }

  if (store.status !== "ACTIVE") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This store is not accepting messages right now.",
    );
  }

  // An order thread keeps order questions out of the general thread
  if (payload.order_id) {
    const orderResult = await query(
      `
            SELECT o.id FROM orders o
            INNER JOIN sub_orders so ON so.order_id = o.id
            WHERE o.id = $1::uuid AND o.user_id = $2::uuid AND so.store_id = $3::uuid
            LIMIT 1
        `,
      [payload.order_id, userId, store.id],
    );

    if (orderResult.rows.length === 0) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        "That order does not include anything from this store.",
      );
    }
  }

  const result = await query(
    `
        INSERT INTO conversations (
            buyer_id, store_id, order_id, subject, "createdAt", "updatedAt"
        ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT (
            buyer_id, store_id,
            COALESCE(order_id, '00000000-0000-0000-0000-000000000000'::uuid)
        ) DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP
        RETURNING *
    `,
    [userId, store.id, payload.order_id || null, payload.subject || null],
  );

  return { ...result.rows[0], store: { id: store.id, name: store.name, slug: store.slug } };
};

// Post a message and fan it out over the socket to anyone watching
const sendMessage = async (
  userId: string,
  conversationId: string,
  payload: any,
) => {
  const { conversation, side } = await resolveParticipant(
    userId,
    conversationId,
  );

  const body = String(payload.body).trim();

  if (!body) {
    throw new ApiError(httpStatus.BAD_REQUEST, "A message cannot be empty.");
  }

  const message = await transaction(async (client) => {
    const created = await client.query(
      `
            INSERT INTO messages (
                conversation_id, sender_id, sender_role, body, attachments, "createdAt"
            ) VALUES ($1::uuid, $2::uuid, $3::"MessageSenderRole", $4, $5, CURRENT_TIMESTAMP)
            RETURNING *
        `,
      [conversationId, userId, side, body, payload.attachments || []],
    );

    // The unread counter belongs to the side that did NOT send
    await client.query(
      `
            UPDATE conversations
            SET
                last_message_at = CURRENT_TIMESTAMP,
                last_message_preview = $1,
                buyer_unread_count = buyer_unread_count + $2,
                store_unread_count = store_unread_count + $3,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $4::uuid
        `,
      [
        body.slice(0, 280),
        side === "STORE" ? 1 : 0,
        side === "BUYER" ? 1 : 0,
        conversationId,
      ],
    );

    return created.rows[0];
  });

  const senderName =
    side === "BUYER" ? conversation.buyer_name : conversation.store_name;

  // Live delivery for anyone in the room, plus a nudge on the recipient's
  // personal channel so an unopened thread still lights up.
  emitToConversation(conversationId, "message:new", {
    ...message,
    sender_name: senderName,
  });

  const recipientId =
    side === "BUYER" ? conversation.owner_id : conversation.buyer_id;

  emitToUser(recipientId, "conversation:updated", {
    conversation_id: conversationId,
    preview: body.slice(0, 280),
    sender_name: senderName,
  });

  await enqueueNotifications({
    user_id: recipientId,
    type: "NEW_MESSAGE",
    title: `New message from ${senderName}`,
    body: body.slice(0, 180),
    data: { conversation_id: conversationId },
  });

  return { ...message, sender_name: senderName };
};

// The buyer's inbox
const myConversations = async (userId: string, filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 20;
  const offset = (page - 1) * limit;

  const result = await query(
    `
        SELECT
            c.id,
            c.subject,
            c.order_id,
            c.last_message_at,
            c.last_message_preview,
            c.buyer_unread_count as unread_count,
            c."createdAt" as "createdAt",
            json_build_object(
                'id', s.id,
                'name', s.name,
                'slug', s.slug,
                'logo', s.logo
            ) as store,
            (SELECT order_number FROM orders WHERE id = c.order_id) as order_number
        FROM conversations c
        INNER JOIN stores s ON c.store_id = s.id
        WHERE c.buyer_id = $1::uuid
        ORDER BY COALESCE(c.last_message_at, c."createdAt") DESC
        LIMIT $2 OFFSET $3
    `,
    [userId, limit, offset],
  );

  const countResult = await query(
    `
        SELECT
            COUNT(*) as total,
            COALESCE(SUM(buyer_unread_count), 0) as unread
        FROM conversations WHERE buyer_id = $1::uuid
    `,
    [userId],
  );

  const total = parseInt(countResult.rows[0].total);
  const totalPage = Math.ceil(total / limit);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage,
      hasNextPage: page < totalPage,
      hasPrevPage: page > 1,
    },
    unreadTotal: parseInt(countResult.rows[0].unread),
    data: result.rows,
  };
};

// The store's inbox
const storeConversations = async (userId: string, filters: any) => {
  const store = await getVendorStore(userId);

  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 20;
  const offset = (page - 1) * limit;

  const result = await query(
    `
        SELECT
            c.id,
            c.subject,
            c.order_id,
            c.last_message_at,
            c.last_message_preview,
            c.store_unread_count as unread_count,
            c."createdAt" as "createdAt",
            json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email,
                'avatar', u.avatar
            ) as buyer,
            (SELECT order_number FROM orders WHERE id = c.order_id) as order_number
        FROM conversations c
        INNER JOIN users u ON c.buyer_id = u.id
        WHERE c.store_id = $1::uuid
        ORDER BY COALESCE(c.last_message_at, c."createdAt") DESC
        LIMIT $2 OFFSET $3
    `,
    [store.id, limit, offset],
  );

  const countResult = await query(
    `
        SELECT
            COUNT(*) as total,
            COALESCE(SUM(store_unread_count), 0) as unread
        FROM conversations WHERE store_id = $1::uuid
    `,
    [store.id],
  );

  const total = parseInt(countResult.rows[0].total);
  const totalPage = Math.ceil(total / limit);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage,
      hasNextPage: page < totalPage,
      hasPrevPage: page > 1,
    },
    unreadTotal: parseInt(countResult.rows[0].unread),
    data: result.rows,
  };
};

// Mark the other side's messages read and zero this side's counter.
//
// Extracted so it can run on its own: a message delivered over the socket while
// the thread is already open is on screen, so leaving it "unread" would keep the
// badge climbing while the reader is looking straight at it.
const clearUnreadFor = async (
  conversationId: string,
  side: "BUYER" | "STORE",
) => {
  await transaction(async (client) => {
    await client.query(
      `
            UPDATE messages
            SET is_read = true, read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
            WHERE conversation_id = $1::uuid
                AND sender_role != $2::"MessageSenderRole"
                AND is_read = false
        `,
      [conversationId, side],
    );

    await client.query(
      `
            UPDATE conversations
            SET
                buyer_unread_count = CASE WHEN $2 = 'BUYER' THEN 0 ELSE buyer_unread_count END,
                store_unread_count = CASE WHEN $2 = 'STORE' THEN 0 ELSE store_unread_count END,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $1::uuid
        `,
      [conversationId, side],
    );
  });
};

// Called by the client when a live message lands in a thread it already has open
const markConversationRead = async (userId: string, conversationId: string) => {
  const { side } = await resolveParticipant(userId, conversationId);
  await clearUnreadFor(conversationId, side);
  return { conversation_id: conversationId, side };
};

// A thread with its messages. Opening it clears that side's unread counter.
const conversationMessages = async (
  userId: string,
  conversationId: string,
  filters: any,
) => {
  const { conversation, side } = await resolveParticipant(
    userId,
    conversationId,
  );

  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 50;
  const offset = (page - 1) * limit;

  const result = await query(
    `
        SELECT
            m.*,
            u.name as sender_name,
            u.avatar as sender_avatar
        FROM messages m
        INNER JOIN users u ON m.sender_id = u.id
        WHERE m.conversation_id = $1::uuid
        ORDER BY m."createdAt" DESC
        LIMIT $2 OFFSET $3
    `,
    [conversationId, limit, offset],
  );

  const countResult = await query(
    `SELECT COUNT(*) as total FROM messages WHERE conversation_id = $1::uuid`,
    [conversationId],
  );

  await clearUnreadFor(conversationId, side);

  const total = parseInt(countResult.rows[0].total);
  const totalPage = Math.ceil(total / limit);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage,
      hasNextPage: page < totalPage,
      hasPrevPage: page > 1,
    },
    conversation: {
      id: conversation.id,
      subject: conversation.subject,
      order_id: conversation.order_id,
      store: { id: conversation.store_id, name: conversation.store_name },
      buyer: { id: conversation.buyer_id, name: conversation.buyer_name },
      my_side: side,
    },
    // Oldest first reads naturally in a transcript
    data: result.rows.reverse(),
  };
};

// Total unread for a badge, whichever side the user is on
const unreadCount = async (userId: string) => {
  const result = await query(
    `
        SELECT
            COALESCE(SUM(c.buyer_unread_count), 0) as buyer_unread
        FROM conversations c WHERE c.buyer_id = $1::uuid
    `,
    [userId],
  );

  const storeResult = await query(
    `
        SELECT COALESCE(SUM(c.store_unread_count), 0) as store_unread
        FROM conversations c
        WHERE c.store_id IN (
            SELECT id FROM stores WHERE owner_id = $1::uuid
            UNION
            SELECT store_id FROM store_staff
            WHERE user_id = $1::uuid
                AND status = 'ACTIVE'::"StaffStatus"
                AND 'CHAT' = ANY(permissions)
        )
    `,
    [userId],
  );

  const buyerUnread = parseInt(result.rows[0].buyer_unread);
  const storeUnread = parseInt(storeResult.rows[0].store_unread);

  return {
    buyer_unread: buyerUnread,
    store_unread: storeUnread,
    unreadCount: buyerUnread + storeUnread,
  };
};

export const ChatService = {
  startConversation,
  sendMessage,
  myConversations,
  storeConversations,
  conversationMessages,
  markConversationRead,
  unreadCount,
  resolveParticipant,
};
