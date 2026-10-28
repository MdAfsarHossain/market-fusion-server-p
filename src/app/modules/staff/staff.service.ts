import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { query, transaction } from "../../utils/db";
import {
  resolveStoreAccess,
  requireOwner,
  STORE_PERMISSIONS,
} from "../../utils/storeAccess";
import { enqueueNotifications } from "../../queues/notification.queue";

// What the logged in user is allowed to do, and for which store. The vendor
// dashboard calls this first so it can hide areas the user cannot reach.
const myAccess = async (userId: string) => {
  const access = await resolveStoreAccess(userId);

  return {
    store: {
      id: access.store.id,
      name: access.store.name,
      slug: access.store.slug,
      status: access.store.status,
    },
    is_owner: access.isOwner,
    role: access.role,
    permissions: access.permissions,
    available_permissions: [...STORE_PERMISSIONS],
  };
};

// Everyone who can act for this store, owner included for context
const allStaff = async (userId: string) => {
  const access = requireOwner(await resolveStoreAccess(userId));

  const result = await query(
    `
        SELECT
            ss.id,
            ss.role,
            ss.permissions,
            ss.status,
            ss.accepted_at,
            ss.revoked_at,
            ss."createdAt" as "createdAt",
            json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email,
                'avatar', u.avatar
            ) as user
        FROM store_staff ss
        INNER JOIN users u ON ss.user_id = u.id
        WHERE ss.store_id = $1::uuid
        ORDER BY ss."createdAt" DESC
    `,
    [access.store.id],
  );

  const owner = await query(
    `SELECT id, name, email, avatar FROM users WHERE id = $1::uuid`,
    [access.store.owner_id],
  );

  return {
    owner: owner.rows[0] || null,
    staff: result.rows,
    available_permissions: [...STORE_PERMISSIONS],
  };
};

// Invite an existing account to help run the store.
//
// Invites are by email against an account that already exists: creating users
// from an invite would need an email flow, so this keeps the surface small.
const inviteStaff = async (userId: string, payload: any) => {
  const access = requireOwner(await resolveStoreAccess(userId));

  const email = String(payload.email).trim().toLowerCase();

  const userResult = await query(
    `SELECT id, name, email, role FROM users WHERE LOWER(email) = $1`,
    [email],
  );

  if (userResult.rows.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "No account uses that email. Ask them to sign up first, then invite them.",
    );
  }

  const invitee = userResult.rows[0];

  if (invitee.id === access.store.owner_id) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "You already own this store.",
    );
  }

  if (["ADMIN", "SUPERADMIN"].includes(invitee.role)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "A marketplace admin cannot be added as store staff.",
    );
  }

  // Someone who already owns a store cannot also staff another one, because
  // resolveStoreAccess would always pick their own store first.
  const ownsAStore = await query(
    `SELECT id FROM stores WHERE owner_id = $1::uuid`,
    [invitee.id],
  );

  if (ownsAStore.rows.length > 0) {
    throw new ApiError(
      httpStatus.CONFLICT,
      "That person already owns a store, so they cannot join yours as staff.",
    );
  }

  const existing = await query(
    `SELECT id, status FROM store_staff WHERE store_id = $1::uuid AND user_id = $2::uuid`,
    [access.store.id, invitee.id],
  );

  const permissions = (payload.permissions || []).filter((permission: string) =>
    STORE_PERMISSIONS.includes(permission as never),
  );

  let record;

  if (existing.rows.length > 0) {
    if (existing.rows[0].status === "ACTIVE") {
      throw new ApiError(
        httpStatus.CONFLICT,
        "That person is already on your team.",
      );
    }

    // Re-inviting somebody who was revoked reuses their row
    const updated = await query(
      `
            UPDATE store_staff
            SET
                role = $1::"StaffRole",
                permissions = $2,
                status = 'INVITED'::"StaffStatus",
                invited_by = $3::uuid,
                revoked_at = NULL,
                accepted_at = NULL,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $4::uuid
            RETURNING *
        `,
      [payload.role || "STAFF", permissions, userId, existing.rows[0].id],
    );
    record = updated.rows[0];
  } else {
    const created = await query(
      `
            INSERT INTO store_staff (
                store_id, user_id, role, permissions, status, invited_by,
                "createdAt", "updatedAt"
            ) VALUES (
                $1::uuid, $2::uuid, $3::"StaffRole", $4, 'INVITED'::"StaffStatus",
                $5::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING *
        `,
      [access.store.id, invitee.id, payload.role || "STAFF", permissions, userId],
    );
    record = created.rows[0];
  }

  await enqueueNotifications({
    user_id: invitee.id,
    type: "STAFF_INVITE",
    title: `${access.store.name} invited you to their team`,
    body: `You have been invited as ${String(record.role).toLowerCase()}. Accept the invite to start helping run the store.`,
    data: { staff_id: record.id, store_id: access.store.id },
  });

  return { ...record, user: invitee };
};

// Invites waiting for the logged in user
const myInvites = async (userId: string) => {
  const result = await query(
    `
        SELECT
            ss.id,
            ss.role,
            ss.permissions,
            ss.status,
            ss."createdAt" as "createdAt",
            json_build_object(
                'id', s.id,
                'name', s.name,
                'slug', s.slug,
                'logo', s.logo
            ) as store
        FROM store_staff ss
        INNER JOIN stores s ON ss.store_id = s.id
        WHERE ss.user_id = $1::uuid AND ss.status = 'INVITED'::"StaffStatus"
        ORDER BY ss."createdAt" DESC
    `,
    [userId],
  );

  return result.rows;
};

// Accept an invite. The account is promoted to VENDOR so the existing vendor
// routes let them through; resolveStoreAccess then points them at the store
// they were invited to.
const acceptInvite = async (userId: string, staffId: string) => {
  const inviteResult = await query(
    `
        SELECT ss.*, s.name as store_name
        FROM store_staff ss
        INNER JOIN stores s ON ss.store_id = s.id
        WHERE ss.id = $1::uuid AND ss.user_id = $2::uuid
    `,
    [staffId, userId],
  );

  if (inviteResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Invite not found.");
  }

  const invite = inviteResult.rows[0];

  if (invite.status === "ACTIVE") {
    throw new ApiError(httpStatus.CONFLICT, "You have already accepted this.");
  }

  if (invite.status === "REVOKED") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This invite is no longer valid.",
    );
  }

  const accepted = await transaction(async (client) => {
    const updated = await client.query(
      `
            UPDATE store_staff
            SET
                status = 'ACTIVE'::"StaffStatus",
                accepted_at = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $1::uuid
            RETURNING *
        `,
      [staffId],
    );

    await client.query(
      `
            UPDATE users
            SET role = 'VENDOR'::"Role", "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $1::uuid AND role = 'USER'::"Role"
        `,
      [userId],
    );

    return updated.rows[0];
  });

  await enqueueNotifications({
    user_id: invite.invited_by,
    type: "STAFF_INVITE",
    title: "Invite accepted",
    body: `Your invite to help run ${invite.store_name} was accepted.`,
    data: { staff_id: staffId },
  });

  return { ...accepted, store_name: invite.store_name };
};

// Decline an invite
const declineInvite = async (userId: string, staffId: string) => {
  const result = await query(
    `
        UPDATE store_staff
        SET
            status = 'REVOKED'::"StaffStatus",
            revoked_at = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1::uuid
            AND user_id = $2::uuid
            AND status = 'INVITED'::"StaffStatus"
        RETURNING id
    `,
    [staffId, userId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Invite not found.");
  }

  return null;
};

// Change what a team member can do
const updateStaff = async (userId: string, staffId: string, payload: any) => {
  const access = requireOwner(await resolveStoreAccess(userId));

  const existing = await query(
    `SELECT id, user_id FROM store_staff WHERE id = $1::uuid AND store_id = $2::uuid`,
    [staffId, access.store.id],
  );

  if (existing.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Team member not found.");
  }

  // Build dynamic update query
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (payload.role !== undefined) {
    updates.push(`role = $${paramCount++}::"StaffRole"`);
    values.push(payload.role);
  }

  if (payload.permissions !== undefined) {
    updates.push(`permissions = $${paramCount++}`);
    values.push(
      payload.permissions.filter((permission: string) =>
        STORE_PERMISSIONS.includes(permission as never),
      ),
    );
  }

  if (updates.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No fields to update");
  }

  updates.push(`"updatedAt" = CURRENT_TIMESTAMP`);
  values.push(staffId);

  const result = await query(
    `
        UPDATE store_staff
        SET ${updates.join(", ")}
        WHERE id = $${paramCount}::uuid
        RETURNING *
    `,
    values,
  );

  return result.rows[0];
};

// Remove somebody from the team
const revokeStaff = async (userId: string, staffId: string) => {
  const access = requireOwner(await resolveStoreAccess(userId));

  const result = await query(
    `
        UPDATE store_staff
        SET
            status = 'REVOKED'::"StaffStatus",
            revoked_at = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1::uuid AND store_id = $2::uuid
        RETURNING user_id
    `,
    [staffId, access.store.id],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Team member not found.");
  }

  await enqueueNotifications({
    user_id: result.rows[0].user_id,
    type: "STAFF_INVITE",
    title: "Store access removed",
    body: `You no longer have access to ${access.store.name}.`,
    data: { store_id: access.store.id },
  });

  return null;
};

export const StaffService = {
  myAccess,
  allStaff,
  inviteStaff,
  myInvites,
  acceptInvite,
  declineInvite,
  updateStaff,
  revokeStaff,
};
