import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { resolveStoreFor } from "../../utils/storeAccess";
import { query, transaction } from "../../utils/db";

const toMoney = (value: number) => Number(value.toFixed(2));

// Resolve the store this user acts for. Delegates to the shared resolver so
// an owner and a permitted staff member reach the same store, and a staff
// member without COUPONS access is refused here rather than deeper in.
const getVendorStore = async (userId: string) => {
  const access = await resolveStoreFor(userId, "COUPONS", {
    requireActive: false,
  });

  return access.store;
};

// Work out what a coupon is worth against a given subtotal
const computeDiscount = (coupon: any, subtotal: number) => {
  let discount =
    coupon.discount_type === "PERCENTAGE"
      ? (subtotal * Number(coupon.discount_value)) / 100
      : Number(coupon.discount_value);

  if (coupon.max_discount_amount) {
    discount = Math.min(discount, Number(coupon.max_discount_amount));
  }

  // A discount can never exceed what is being bought
  return toMoney(Math.min(discount, subtotal));
};

// Validate a code for one user against one cart, and price it.
//
// Shared by the preview endpoint and by checkout, so the number a buyer is
// shown is the number they are charged.
const validateCoupon = async (
  userId: string,
  code: string,
  lines: { store_id: string; line_total: number }[],
  client?: any,
) => {
  const run = client
    ? (text: string, params: any[]) => client.query(text, params)
    : query;

  const normalised = String(code || "").trim().toUpperCase();

  if (!normalised) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Please provide a coupon code.");
  }

  const couponResult = await run(
    `SELECT * FROM coupons WHERE UPPER(code) = $1`,
    [normalised],
  );

  if (couponResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "This coupon code is not valid.");
  }

  const coupon = couponResult.rows[0];

  if (!coupon.is_active) {
    throw new ApiError(httpStatus.BAD_REQUEST, "This coupon is no longer active.");
  }

  const now = new Date();

  if (coupon.starts_at && new Date(coupon.starts_at) > now) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This coupon is not active yet.",
    );
  }

  if (coupon.expires_at && new Date(coupon.expires_at) < now) {
    throw new ApiError(httpStatus.BAD_REQUEST, "This coupon has expired.");
  }

  if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This coupon has reached its usage limit.",
    );
  }

  if (coupon.usage_limit_per_user !== null) {
    const usedResult = await run(
      `
            SELECT COUNT(*) as total FROM coupon_usages
            WHERE coupon_id = $1::uuid AND user_id = $2::uuid
        `,
      [coupon.id, userId],
    );

    if (parseInt(usedResult.rows[0].total) >= coupon.usage_limit_per_user) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "You have already used this coupon.",
      );
    }
  }

  // A vendor coupon only discounts that vendor's share of the cart
  const eligibleLines = coupon.store_id
    ? lines.filter((line) => line.store_id === coupon.store_id)
    : lines;

  if (eligibleLines.length === 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This coupon does not apply to anything in your cart.",
    );
  }

  const eligibleSubtotal = toMoney(
    eligibleLines.reduce((sum, line) => sum + Number(line.line_total), 0),
  );

  if (eligibleSubtotal < Number(coupon.min_order_amount)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `This coupon needs a minimum order of ${Number(coupon.min_order_amount).toFixed(2)}.`,
    );
  }

  const discount = computeDiscount(coupon, eligibleSubtotal);

  return {
    coupon,
    discount,
    eligibleSubtotal,
    // Which vendor bears the discount, so sub order totals stay honest
    scopedStoreId: coupon.store_id as string | null,
  };
};

// Record that a coupon was used on an order
const recordCouponUsage = async (
  client: any,
  couponId: string,
  userId: string,
  orderId: string,
  discountAmount: number,
) => {
  await client.query(
    `
        INSERT INTO coupon_usages (coupon_id, user_id, order_id, discount_amount, "createdAt")
        VALUES ($1::uuid, $2::uuid, $3::uuid, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (coupon_id, order_id) DO NOTHING
    `,
    [couponId, userId, orderId, discountAmount],
  );

  await client.query(
    `
        UPDATE coupons
        SET used_count = used_count + 1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1::uuid
    `,
    [couponId],
  );
};

// Give a usage slot back when an order that used a coupon is cancelled
const releaseCouponUsage = async (client: any, orderId: string) => {
  const usage = await client.query(
    `SELECT coupon_id FROM coupon_usages WHERE order_id = $1::uuid`,
    [orderId],
  );

  if (usage.rows.length === 0) {
    return;
  }

  await client.query(`DELETE FROM coupon_usages WHERE order_id = $1::uuid`, [
    orderId,
  ]);

  await client.query(
    `
        UPDATE coupons
        SET used_count = GREATEST(used_count - 1, 0), "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1::uuid
    `,
    [usage.rows[0].coupon_id],
  );
};

// Preview a coupon against the buyer's current cart
const previewCoupon = async (userId: string, code: string) => {
  const cartResult = await query(
    `
        SELECT ci.store_id, (ci.unit_price * ci.quantity) as line_total
        FROM cart_items ci
        INNER JOIN carts c ON ci.cart_id = c.id
        WHERE c.user_id = $1::uuid
    `,
    [userId],
  );

  if (cartResult.rows.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Your cart is empty.");
  }

  const lines = cartResult.rows.map((row: any) => ({
    store_id: row.store_id,
    line_total: Number(row.line_total),
  }));

  const cartSubtotal = toMoney(
    lines.reduce((sum: number, line: any) => sum + line.line_total, 0),
  );

  const { coupon, discount, eligibleSubtotal } = await validateCoupon(
    userId,
    code,
    lines,
  );

  return {
    code: coupon.code,
    name: coupon.name,
    discount_type: coupon.discount_type,
    discount_value: coupon.discount_value,
    scope: coupon.store_id ? "STORE" : "PLATFORM",
    cart_subtotal: cartSubtotal,
    eligible_subtotal: eligibleSubtotal,
    discount_amount: discount,
    payable: toMoney(cartSubtotal - discount),
  };
};

// Create Coupon. A vendor's coupon is locked to their own store; an admin's
// coupon is platform wide unless they name a store.
const createCoupon = async (userId: string, role: string, payload: any) => {
  const isAdmin = role === "ADMIN" || role === "SUPERADMIN";
  let storeId: string | null = null;

  if (isAdmin) {
    storeId = payload.store_id || null;

    if (storeId) {
      const storeResult = await query(
        `SELECT id FROM stores WHERE id = $1::uuid`,
        [storeId],
      );

      if (storeResult.rows.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, "Store not found.");
      }
    }
  } else {
    const store = await getVendorStore(userId);

    if (store.status !== "ACTIVE") {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        "Only an approved store can create coupons.",
      );
    }

    storeId = store.id;
  }

  const code = String(payload.code).trim().toUpperCase();

  const existing = await query(`SELECT id FROM coupons WHERE UPPER(code) = $1`, [
    code,
  ]);

  if (existing.rows.length > 0) {
    throw new ApiError(httpStatus.CONFLICT, "This coupon code already exists.");
  }

  if (
    payload.discount_type === "PERCENTAGE" &&
    Number(payload.discount_value) > 100
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "A percentage discount cannot be more than 100.",
    );
  }

  if (
    payload.starts_at &&
    payload.expires_at &&
    new Date(payload.expires_at) <= new Date(payload.starts_at)
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "The expiry date must be after the start date.",
    );
  }

  const result = await query(
    `
        INSERT INTO coupons (
            store_id,
            code,
            name,
            description,
            discount_type,
            discount_value,
            max_discount_amount,
            min_order_amount,
            usage_limit,
            usage_limit_per_user,
            starts_at,
            expires_at,
            created_by,
            "createdAt",
            "updatedAt"
        ) VALUES (
            $1::uuid, $2, $3, $4, $5::"DiscountType", $6, $7, $8, $9, $10,
            COALESCE($11::timestamp, CURRENT_TIMESTAMP), $12::timestamp, $13::uuid,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        RETURNING *
    `,
    [
      storeId,
      code,
      payload.name,
      payload.description || null,
      payload.discount_type,
      payload.discount_value,
      payload.max_discount_amount ?? null,
      payload.min_order_amount ?? 0,
      payload.usage_limit ?? null,
      payload.usage_limit_per_user ?? 1,
      payload.starts_at || null,
      payload.expires_at || null,
      userId,
    ],
  );

  return result.rows[0];
};

// Coupons a buyer could actually use right now
const availableCoupons = async (filters: any) => {
  const storeId = filters.store_id || null;

  const result = await query(
    `
        SELECT
            c.id,
            c.code,
            c.name,
            c.description,
            c.discount_type,
            c.discount_value,
            c.max_discount_amount,
            c.min_order_amount,
            c.expires_at,
            CASE WHEN c.store_id IS NULL THEN 'PLATFORM' ELSE 'STORE' END as scope,
            CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object(
                'id', s.id,
                'name', s.name,
                'slug', s.slug
            ) END as store
        FROM coupons c
        LEFT JOIN stores s ON c.store_id = s.id
        WHERE c.is_active = true
            AND (c.starts_at IS NULL OR c.starts_at <= CURRENT_TIMESTAMP)
            AND (c.expires_at IS NULL OR c.expires_at > CURRENT_TIMESTAMP)
            AND (c.usage_limit IS NULL OR c.used_count < c.usage_limit)
            AND ($1::uuid IS NULL OR c.store_id = $1::uuid OR c.store_id IS NULL)
        ORDER BY c.store_id NULLS FIRST, c."createdAt" DESC
    `,
    [storeId],
  );

  return result.rows;
};

// Coupons belonging to the logged in vendor's store
const myCoupons = async (userId: string, filters: any) => {
  const store = await getVendorStore(userId);

  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;

  const result = await query(
    `
        SELECT *
        FROM coupons
        WHERE store_id = $1::uuid
        ORDER BY "createdAt" DESC
        LIMIT $2 OFFSET $3
    `,
    [store.id, limit, offset],
  );

  const countResult = await query(
    `SELECT COUNT(*) as total FROM coupons WHERE store_id = $1::uuid`,
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
    data: result.rows,
  };
};

// Every coupon, for admin
const allCouponsForAdmin = async (filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const searchTerm = filters.searchTerm || null;
  const scope = filters.scope || null;

  const result = await query(
    `
        SELECT
            c.*,
            CASE WHEN s.id IS NULL THEN NULL ELSE json_build_object(
                'id', s.id,
                'name', s.name,
                'slug', s.slug
            ) END as store
        FROM coupons c
        LEFT JOIN stores s ON c.store_id = s.id
        WHERE ($1::text IS NULL OR c.code ILIKE '%' || $1 || '%' OR c.name ILIKE '%' || $1 || '%')
            AND (
                $2::text IS NULL
                OR ($2 = 'PLATFORM' AND c.store_id IS NULL)
                OR ($2 = 'STORE' AND c.store_id IS NOT NULL)
            )
        ORDER BY c."createdAt" DESC
        LIMIT $3 OFFSET $4
    `,
    [searchTerm, scope, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM coupons c
        WHERE ($1::text IS NULL OR c.code ILIKE '%' || $1 || '%' OR c.name ILIKE '%' || $1 || '%')
            AND (
                $2::text IS NULL
                OR ($2 = 'PLATFORM' AND c.store_id IS NULL)
                OR ($2 = 'STORE' AND c.store_id IS NOT NULL)
            )
    `,
    [searchTerm, scope],
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
    data: result.rows,
  };
};

// Make sure the caller owns this coupon before letting them touch it
const getEditableCoupon = async (
  userId: string,
  role: string,
  couponId: string,
) => {
  const isAdmin = role === "ADMIN" || role === "SUPERADMIN";

  const result = await query(`SELECT * FROM coupons WHERE id = $1::uuid`, [
    couponId,
  ]);

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Coupon not found.");
  }

  const coupon = result.rows[0];

  if (!isAdmin) {
    const store = await getVendorStore(userId);

    if (coupon.store_id !== store.id) {
      throw new ApiError(
        httpStatus.NOT_FOUND,
        "Coupon not found in your store.",
      );
    }
  }

  return coupon;
};

// Update Coupon
const updateCoupon = async (
  userId: string,
  role: string,
  couponId: string,
  payload: any,
) => {
  const coupon = await getEditableCoupon(userId, role, couponId);

  if (
    payload.discount_type === "PERCENTAGE" &&
    payload.discount_value !== undefined &&
    Number(payload.discount_value) > 100
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "A percentage discount cannot be more than 100.",
    );
  }

  // Build dynamic update query
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (payload.name !== undefined) {
    updates.push(`name = $${paramCount++}`);
    values.push(payload.name);
  }

  if (payload.description !== undefined) {
    updates.push(`description = $${paramCount++}`);
    values.push(payload.description);
  }

  if (payload.discount_type !== undefined) {
    updates.push(`discount_type = $${paramCount++}::"DiscountType"`);
    values.push(payload.discount_type);
  }

  if (payload.discount_value !== undefined) {
    updates.push(`discount_value = $${paramCount++}`);
    values.push(payload.discount_value);
  }

  if (payload.max_discount_amount !== undefined) {
    updates.push(`max_discount_amount = $${paramCount++}`);
    values.push(payload.max_discount_amount);
  }

  if (payload.min_order_amount !== undefined) {
    updates.push(`min_order_amount = $${paramCount++}`);
    values.push(payload.min_order_amount);
  }

  if (payload.usage_limit !== undefined) {
    updates.push(`usage_limit = $${paramCount++}`);
    values.push(payload.usage_limit);
  }

  if (payload.usage_limit_per_user !== undefined) {
    updates.push(`usage_limit_per_user = $${paramCount++}`);
    values.push(payload.usage_limit_per_user);
  }

  if (payload.starts_at !== undefined) {
    updates.push(`starts_at = $${paramCount++}::timestamp`);
    values.push(payload.starts_at);
  }

  if (payload.expires_at !== undefined) {
    updates.push(`expires_at = $${paramCount++}::timestamp`);
    values.push(payload.expires_at);
  }

  if (payload.is_active !== undefined) {
    updates.push(`is_active = $${paramCount++}`);
    values.push(payload.is_active);
  }

  if (updates.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No fields to update");
  }

  updates.push(`"updatedAt" = CURRENT_TIMESTAMP`);
  values.push(coupon.id);

  const result = await query(
    `
        UPDATE coupons
        SET ${updates.join(", ")}
        WHERE id = $${paramCount}::uuid
        RETURNING *
    `,
    values,
  );

  return result.rows[0];
};

// Delete Coupon - deactivated instead once it has been used
const deleteCoupon = async (userId: string, role: string, couponId: string) => {
  const coupon = await getEditableCoupon(userId, role, couponId);

  const usedResult = await query(
    `SELECT COUNT(*) as total FROM coupon_usages WHERE coupon_id = $1::uuid`,
    [coupon.id],
  );

  if (parseInt(usedResult.rows[0].total) > 0) {
    await query(
      `
            UPDATE coupons
            SET is_active = false, "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $1::uuid
        `,
      [coupon.id],
    );

    return {
      deactivated: true,
      message:
        "This coupon has already been used, so it was deactivated instead of deleted.",
    };
  }

  await query(`DELETE FROM coupons WHERE id = $1::uuid`, [coupon.id]);

  return { deactivated: false, message: "Coupon deleted successfully." };
};

export const CouponService = {
  createCoupon,
  availableCoupons,
  previewCoupon,
  myCoupons,
  allCouponsForAdmin,
  updateCoupon,
  deleteCoupon,
  // Used by the order module
  validateCoupon,
  recordCouponUsage,
  releaseCouponUsage,
};
