import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { query, transaction } from "../../utils/db";
import { S3Uploader } from "../../lib/S3Uploader";
import slugify from "../../utils/slugify";
import { enqueueNotifications } from "../../queues/notification.queue";
import { emitStoreStatus } from "../../lib/statusEvents";

// Build a store slug that is guaranteed not to collide
const generateUniqueSlug = async (name: string) => {
  const baseSlug = slugify(name) || "store";
  let slug = baseSlug;
  let suffix = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await query(`SELECT id FROM stores WHERE slug = $1`, [
      slug,
    ]);

    if (existing.rows.length === 0) {
      break;
    }

    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  return slug;
};

// Upload the store logo / banner when they are part of the request
const uploadStoreAssets = async (storeSlug: string, files?: any) => {
  const assets: { logo?: string; banner?: string } = {};

  if (!files) {
    return assets;
  }

  try {
    if (files.logo?.[0]) {
      const uploaded = await S3Uploader.uploadToS3(
        files.logo[0],
        `stores/${storeSlug}/logo`,
      );
      assets.logo = uploaded.Location;
    }

    if (files.banner?.[0]) {
      const uploaded = await S3Uploader.uploadToS3(
        files.banner[0],
        `stores/${storeSlug}/banner`,
      );
      assets.banner = uploaded.Location;
    }
  } catch (error) {
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Store image upload failed.",
    );
  }

  return assets;
};

// Become a vendor - create a store for the logged in user
const createStore = async (userId: string, payload: any, files?: any) => {
  // A user can only own one store in Phase 1
  const existingStore = await query(
    `
        SELECT id FROM stores WHERE owner_id = $1::uuid
    `,
    [userId],
  );

  if (existingStore.rows.length > 0) {
    throw new ApiError(
      httpStatus.CONFLICT,
      "You already have a store. Please update your existing store instead.",
    );
  }

  const slug = await generateUniqueSlug(payload.name);
  const assets = await uploadStoreAssets(slug, files);

  const store = await transaction(async (client) => {
    const storeResult = await client.query(
      `
            INSERT INTO stores (
                owner_id,
                name,
                slug,
                tagline,
                description,
                logo,
                banner,
                email,
                phone,
                address,
                city,
                country,
                status,
                "createdAt",
                "updatedAt"
            ) VALUES (
                $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                $13::"StoreStatus", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING *
        `,
      [
        userId,
        payload.name,
        slug,
        payload.tagline || null,
        payload.description || null,
        assets.logo || null,
        assets.banner || null,
        payload.email || null,
        payload.phone || null,
        payload.address || null,
        payload.city || null,
        payload.country || null,
        "PENDING",
      ],
    );

    // Promote the owner to VENDOR, but never downgrade an admin
    await client.query(
      `
            UPDATE users
            SET
                role = 'VENDOR'::"Role",
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $1::uuid
                AND role IN ('USER'::"Role", 'BUSINESS'::"Role")
        `,
      [userId],
    );

    return storeResult.rows[0];
  });

  // Let admins see the new store in their review queue straight away
  emitStoreStatus(store);

  return store;
};

// My Store - the logged in vendor's own store
const myStore = async (userId: string) => {
  const result = await query(
    `
        SELECT
            s.*,
            json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email,
                'avatar', u.avatar,
                'phone_number', u.phone_number
            ) as owner,
            (
                SELECT COUNT(*) FROM products p
                WHERE p.store_id = s.id AND p.status = 'PUBLISHED'::"ProductStatus"
            ) as published_products,
            (
                SELECT COUNT(*) FROM products p WHERE p.store_id = s.id
            ) as all_products
        FROM stores s
        LEFT JOIN users u ON s.owner_id = u.id
        WHERE s.owner_id = $1::uuid
    `,
    [userId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "You do not have a store yet. Please create one first.",
    );
  }

  return result.rows[0];
};

// Update My Store
const updateMyStore = async (userId: string, payload: any, files?: any) => {
  const storeResult = await query(
    `
        SELECT id, slug FROM stores WHERE owner_id = $1::uuid
    `,
    [userId],
  );

  if (storeResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Store not found.");
  }

  const existingStore = storeResult.rows[0];
  const assets = await uploadStoreAssets(existingStore.slug, files);

  // Build dynamic update query
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (payload.name !== undefined) {
    updates.push(`name = $${paramCount++}`);
    values.push(payload.name);
  }

  if (payload.tagline !== undefined) {
    updates.push(`tagline = $${paramCount++}`);
    values.push(payload.tagline);
  }

  if (payload.description !== undefined) {
    updates.push(`description = $${paramCount++}`);
    values.push(payload.description);
  }

  if (payload.email !== undefined) {
    updates.push(`email = $${paramCount++}`);
    values.push(payload.email);
  }

  if (payload.phone !== undefined) {
    updates.push(`phone = $${paramCount++}`);
    values.push(payload.phone);
  }

  if (payload.address !== undefined) {
    updates.push(`address = $${paramCount++}`);
    values.push(payload.address);
  }

  if (payload.city !== undefined) {
    updates.push(`city = $${paramCount++}`);
    values.push(payload.city);
  }

  if (payload.country !== undefined) {
    updates.push(`country = $${paramCount++}`);
    values.push(payload.country);
  }

  if (assets.logo) {
    updates.push(`logo = $${paramCount++}`);
    values.push(assets.logo);
  }

  if (assets.banner) {
    updates.push(`banner = $${paramCount++}`);
    values.push(assets.banner);
  }

  if (updates.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No fields to update");
  }

  updates.push(`"updatedAt" = CURRENT_TIMESTAMP`);
  values.push(existingStore.id);

  const result = await query(
    `
        UPDATE stores
        SET ${updates.join(", ")}
        WHERE id = $${paramCount}::uuid
        RETURNING *
    `,
    values,
  );

  return result.rows[0];
};

// All Stores - public storefront listing, only approved and active stores
const allStores = async (filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const searchTerm = filters.searchTerm || null;

  const storesResult = await query(
    `
        SELECT
            s.id,
            s.name,
            s.slug,
            s.tagline,
            s.logo,
            s.banner,
            s.city,
            s.country,
            s.rating,
            s.total_reviews,
            s.total_products,
            s."createdAt" as "createdAt"
        FROM stores s
        WHERE s.status = 'ACTIVE'::"StoreStatus"
            AND s.is_active = true
            AND ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%' OR s.tagline ILIKE '%' || $1 || '%')
        ORDER BY s.rating DESC, s."createdAt" DESC
        LIMIT $2 OFFSET $3
    `,
    [searchTerm, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM stores s
        WHERE s.status = 'ACTIVE'::"StoreStatus"
            AND s.is_active = true
            AND ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%' OR s.tagline ILIKE '%' || $1 || '%')
    `,
    [searchTerm],
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
    data: storesResult.rows,
  };
};

// Single Store - public storefront detail by slug
const storeBySlug = async (slug: string) => {
  const result = await query(
    `
        SELECT
            s.id,
            s.name,
            s.slug,
            s.tagline,
            s.description,
            s.logo,
            s.banner,
            s.email,
            s.phone,
            s.city,
            s.country,
            s.rating,
            s.total_reviews,
            s.total_products,
            s."createdAt" as "createdAt",
            (
                SELECT COUNT(*) FROM products p
                WHERE p.store_id = s.id AND p.status = 'PUBLISHED'::"ProductStatus"
            ) as published_products
        FROM stores s
        WHERE s.slug = $1
            AND s.status = 'ACTIVE'::"StoreStatus"
            AND s.is_active = true
    `,
    [slug],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Store not found.");
  }

  return result.rows[0];
};

// All Stores for admin - every store regardless of status
const allStoresForAdmin = async (filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const searchTerm = filters.searchTerm || null;
  const status = filters.status || null;

  const storesResult = await query(
    `
        SELECT
            s.*,
            json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email,
                'avatar', u.avatar,
                'phone_number', u.phone_number,
                'kyc_verification_status', u.kyc_verification_status
            ) as owner
        FROM stores s
        LEFT JOIN users u ON s.owner_id = u.id
        WHERE ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR s.status = $2::"StoreStatus")
        ORDER BY s."createdAt" DESC
        LIMIT $3 OFFSET $4
    `,
    [searchTerm, status, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM stores s
        LEFT JOIN users u ON s.owner_id = u.id
        WHERE ($1::text IS NULL OR s.name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR s.status = $2::"StoreStatus")
    `,
    [searchTerm, status],
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
    data: storesResult.rows,
  };
};

// Approve / reject / suspend a store
const updateStoreStatus = async (storeId: string, payload: any) => {
  const storeResult = await query(
    `
        SELECT id, status, name, owner_id FROM stores WHERE id = $1::uuid
    `,
    [storeId],
  );

  if (storeResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Store not found.");
  }

  if (payload.status === "REJECTED" && !payload.rejection_reason) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "A rejection reason is required when rejecting a store.",
    );
  }

  const result = await query(
    `
        UPDATE stores
        SET
            status = $1::"StoreStatus",
            rejection_reason = $2,
            commission_rate = COALESCE($3, commission_rate),
            approved_at = CASE WHEN $1 = 'ACTIVE' THEN CURRENT_TIMESTAMP ELSE approved_at END,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $4::uuid
        RETURNING *
    `,
    [
      payload.status,
      payload.status === "REJECTED" ? payload.rejection_reason : null,
      payload.commission_rate ?? null,
      storeId,
    ],
  );

  const store = storeResult.rows[0];

  emitStoreStatus(result.rows[0], store.status);

  await enqueueNotifications({
    user_id: store.owner_id,
    type: "STORE_STATUS",
    title:
      payload.status === "ACTIVE"
        ? "Your store is approved"
        : `Your store is now ${payload.status.toLowerCase()}`,
    body:
      payload.status === "ACTIVE"
        ? `${store.name} is live. You can start listing products now.`
        : payload.status === "REJECTED"
          ? `${store.name} was rejected: ${payload.rejection_reason}`
          : `${store.name} is now ${payload.status.toLowerCase()}.`,
    data: { store_id: storeId, status: payload.status },
  });

  return result.rows[0];
};

export const StoreService = {
  createStore,
  myStore,
  updateMyStore,
  allStores,
  storeBySlug,
  allStoresForAdmin,
  updateStoreStatus,
};
