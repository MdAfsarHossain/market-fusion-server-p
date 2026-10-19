import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { query } from "../../utils/db";

export type NotificationPayload = {
  user_id: string;
  type: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
};

// Write one notification row. Used by the worker and by the inline fallback.
const createNotification = async (payload: NotificationPayload) => {
  const result = await query(
    `
        INSERT INTO notifications (user_id, type, title, body, data, "createdAt")
        VALUES ($1::uuid, $2::"NotificationType", $3, $4, $5::jsonb, CURRENT_TIMESTAMP)
        RETURNING *
    `,
    [
      payload.user_id,
      payload.type,
      payload.title,
      payload.body || null,
      JSON.stringify(payload.data || {}),
    ],
  );

  return result.rows[0];
};

// Write many at once, e.g. notifying every vendor in a split order
const createManyNotifications = async (payloads: NotificationPayload[]) => {
  if (!payloads.length) {
    return [];
  }

  const values: any[] = [];
  const rows = payloads.map((payload, index) => {
    const base = index * 5;
    values.push(
      payload.user_id,
      payload.type,
      payload.title,
      payload.body || null,
      JSON.stringify(payload.data || {}),
    );
    return `($${base + 1}::uuid, $${base + 2}::"NotificationType", $${base + 3}, $${base + 4}, $${base + 5}::jsonb, CURRENT_TIMESTAMP)`;
  });

  const result = await query(
    `
        INSERT INTO notifications (user_id, type, title, body, data, "createdAt")
        VALUES ${rows.join(", ")}
        RETURNING id
    `,
    values,
  );

  return result.rows;
};

// My Notifications
const myNotifications = async (userId: string, filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 20;
  const offset = (page - 1) * limit;
  const unreadOnly = filters.unread === "true";

  const notificationsResult = await query(
    `
        SELECT *
        FROM notifications
        WHERE user_id = $1::uuid
            AND ($2::boolean IS FALSE OR is_read = false)
        ORDER BY "createdAt" DESC
        LIMIT $3 OFFSET $4
    `,
    [userId, unreadOnly, limit, offset],
  );

  const countResult = await query(
    `
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE is_read = false) as unread
        FROM notifications
        WHERE user_id = $1::uuid
    `,
    [userId],
  );

  const total = parseInt(
    unreadOnly ? countResult.rows[0].unread : countResult.rows[0].total,
  );
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
    unreadCount: parseInt(countResult.rows[0].unread),
    data: notificationsResult.rows,
  };
};

// Unread count only - cheap enough for a navbar badge to poll
const unreadCount = async (userId: string) => {
  const result = await query(
    `
        SELECT COUNT(*) as unread
        FROM notifications
        WHERE user_id = $1::uuid AND is_read = false
    `,
    [userId],
  );

  return { unreadCount: parseInt(result.rows[0].unread) };
};

// Mark one notification read
const markAsRead = async (userId: string, notificationId: string) => {
  const result = await query(
    `
        UPDATE notifications
        SET
            is_read = true,
            read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE id = $1::uuid AND user_id = $2::uuid
        RETURNING *
    `,
    [notificationId, userId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Notification not found.");
  }

  return result.rows[0];
};

// Mark everything read
const markAllAsRead = async (userId: string) => {
  const result = await query(
    `
        UPDATE notifications
        SET
            is_read = true,
            read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE user_id = $1::uuid AND is_read = false
        RETURNING id
    `,
    [userId],
  );

  return { updated: result.rows.length };
};

// Delete one notification
const deleteNotification = async (userId: string, notificationId: string) => {
  const result = await query(
    `
        DELETE FROM notifications
        WHERE id = $1::uuid AND user_id = $2::uuid
        RETURNING id
    `,
    [notificationId, userId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Notification not found.");
  }

  return null;
};

export const NotificationService = {
  createNotification,
  createManyNotifications,
  myNotifications,
  unreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
