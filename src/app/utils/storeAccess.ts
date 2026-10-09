import httpStatus from "http-status";
import ApiError from "../errors/ApiError";
import { query } from "./db";

// Everything a staff member can be granted. The owner always has all of them.
export const STORE_PERMISSIONS = [
  "PRODUCTS",
  "INVENTORY",
  "ORDERS",
  "BOOKINGS",
  "COUPONS",
  "REVIEWS",
  "CHAT",
  "ANALYTICS",
  "WALLET",
] as const;

export type StorePermission = (typeof STORE_PERMISSIONS)[number];

// Managing staff is never delegated: only the owner can add or remove people.
export const OWNER_ONLY_PERMISSIONS = ["STAFF"] as const;

export type StoreAccess = {
  store: {
    id: string;
    name: string;
    slug: string;
    status: string;
    owner_id: string;
    commission_rate: string | number;
  };
  isOwner: boolean;
  role: "OWNER" | "MANAGER" | "STAFF";
  permissions: string[];
};

// Resolve which store a user acts for, whether they own it or work for it.
//
// This is the single place that answers "whose store is this request about", so
// adding staff did not mean auditing every vendor endpoint for ownership checks.
export const resolveStoreAccess = async (
  userId: string,
): Promise<StoreAccess> => {
  const owned = await query(
    `
        SELECT id, name, slug, status, owner_id, commission_rate
        FROM stores
        WHERE owner_id = $1::uuid
    `,
    [userId],
  );

  if (owned.rows.length > 0) {
    return {
      store: owned.rows[0],
      isOwner: true,
      role: "OWNER",
      permissions: [...STORE_PERMISSIONS],
    };
  }

  const staff = await query(
    `
        SELECT
            ss.role,
            ss.permissions,
            s.id,
            s.name,
            s.slug,
            s.status,
            s.owner_id,
            s.commission_rate
        FROM store_staff ss
        INNER JOIN stores s ON ss.store_id = s.id
        WHERE ss.user_id = $1::uuid AND ss.status = 'ACTIVE'::"StaffStatus"
        ORDER BY ss."createdAt" ASC
        LIMIT 1
    `,
    [userId],
  );

  if (staff.rows.length > 0) {
    const row = staff.rows[0];

    return {
      store: {
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        owner_id: row.owner_id,
        commission_rate: row.commission_rate,
      },
      isOwner: false,
      role: row.role,
      permissions: row.permissions || [],
    };
  }

  throw new ApiError(
    httpStatus.NOT_FOUND,
    "You do not have a store yet. Please create one first.",
  );
};

// Same as above, but also insists the store has been approved
export const resolveActiveStoreAccess = async (userId: string) => {
  const access = await resolveStoreAccess(userId);

  if (access.store.status !== "ACTIVE") {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      `This store is ${String(access.store.status).toLowerCase()}. Only an approved store can do that.`,
    );
  }

  return access;
};

// Refuse the request when a staff member has not been granted this area
export const requirePermission = (
  access: StoreAccess,
  permission: StorePermission,
) => {
  if (access.isOwner || access.permissions.includes(permission)) {
    return access;
  }

  throw new ApiError(
    httpStatus.FORBIDDEN,
    `You do not have permission to manage ${permission.toLowerCase()} for this store.`,
  );
};

// For the handful of things only an owner may ever do
export const requireOwner = (access: StoreAccess) => {
  if (!access.isOwner) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "Only the store owner can do that.",
    );
  }

  return access;
};

// Convenience: resolve and permission-check in one call
export const resolveStoreFor = async (
  userId: string,
  permission: StorePermission,
  options: { requireActive?: boolean } = {},
) => {
  const access = options.requireActive
    ? await resolveActiveStoreAccess(userId)
    : await resolveStoreAccess(userId);

  return requirePermission(access, permission);
};
