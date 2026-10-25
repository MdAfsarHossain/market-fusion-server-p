import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { resolveStoreFor } from "../../utils/storeAccess";
import { query, transaction } from "../../utils/db";
import { enqueueNotifications } from "../../queues/notification.queue";

// Resolve the store this user acts for. Delegates to the shared resolver so
// an owner and a permitted staff member reach the same store, and a staff
// member without REVIEWS access is refused here rather than deeper in.
const getVendorStore = async (userId: string) => {
  const access = await resolveStoreFor(userId, "REVIEWS", {
    requireActive: false,
  });

  return access.store;
};

// Recompute the cached rating on a product and its store from PUBLISHED reviews
// only, so a rejected review never influences what buyers see.
const refreshRatings = async (
  client: any,
  productId: string,
  storeId: string,
) => {
  await client.query(
    `
        UPDATE products p
        SET
            rating = COALESCE(agg.avg_rating, 0),
            total_reviews = COALESCE(agg.total, 0),
            "updatedAt" = CURRENT_TIMESTAMP
        FROM (
            SELECT
                ROUND(AVG(rating)::numeric, 2) as avg_rating,
                COUNT(*) as total
            FROM reviews
            WHERE product_id = $1::uuid AND status = 'PUBLISHED'::"ReviewStatus"
        ) agg
        WHERE p.id = $1::uuid
    `,
    [productId],
  );

  await client.query(
    `
        UPDATE stores s
        SET
            rating = COALESCE(agg.avg_rating, 0),
            total_reviews = COALESCE(agg.total, 0),
            "updatedAt" = CURRENT_TIMESTAMP
        FROM (
            SELECT
                ROUND(AVG(rating)::numeric, 2) as avg_rating,
                COUNT(*) as total
            FROM reviews
            WHERE store_id = $1::uuid AND status = 'PUBLISHED'::"ReviewStatus"
        ) agg
        WHERE s.id = $1::uuid
    `,
    [storeId],
  );
};

// Order items the buyer has received and not yet reviewed
const reviewableItems = async (userId: string) => {
  const result = await query(
    `
        SELECT
            oi.id as order_item_id,
            oi.product_id,
            oi.title,
            oi.thumbnail,
            oi.variant_name,
            o.order_number,
            so.completed_at,
            so.delivered_at,
            json_build_object(
                'id', s.id,
                'name', s.name,
                'slug', s.slug
            ) as store,
            p.slug as product_slug
        FROM order_items oi
        INNER JOIN orders o ON oi.order_id = o.id
        INNER JOIN sub_orders so ON oi.sub_order_id = so.id
        INNER JOIN stores s ON oi.store_id = s.id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.user_id = $1::uuid
            AND oi.is_reviewed = false
            AND oi.product_id IS NOT NULL
            AND so.status IN ('DELIVERED'::"OrderStatus", 'COMPLETED'::"OrderStatus")
        ORDER BY COALESCE(so.completed_at, so.delivered_at) DESC
    `,
    [userId],
  );

  return result.rows;
};

// Create Review. Only a buyer who received the item may review it, and only once.
const createReview = async (userId: string, payload: any) => {
  const itemResult = await query(
    `
        SELECT
            oi.id,
            oi.product_id,
            oi.store_id,
            oi.is_reviewed,
            oi.title,
            o.user_id,
            so.status as sub_order_status,
            s.owner_id as vendor_id,
            s.name as store_name
        FROM order_items oi
        INNER JOIN orders o ON oi.order_id = o.id
        INNER JOIN sub_orders so ON oi.sub_order_id = so.id
        INNER JOIN stores s ON oi.store_id = s.id
        WHERE oi.id = $1::uuid
    `,
    [payload.order_item_id],
  );

  if (itemResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Order item not found.");
  }

  const item = itemResult.rows[0];

  if (item.user_id !== userId) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "You can only review items from your own orders.",
    );
  }

  if (!["DELIVERED", "COMPLETED"].includes(item.sub_order_status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "You can review this item once it has been delivered.",
    );
  }

  if (item.is_reviewed) {
    throw new ApiError(
      httpStatus.CONFLICT,
      "You have already reviewed this item.",
    );
  }

  if (!item.product_id) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This product is no longer available to review.",
    );
  }

  const review = await transaction(async (client) => {
    const created = await client.query(
      `
            INSERT INTO reviews (
                product_id,
                store_id,
                user_id,
                order_item_id,
                rating,
                title,
                comment,
                images,
                "createdAt",
                "updatedAt"
            ) VALUES (
                $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7, $8,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING *
        `,
      [
        item.product_id,
        item.store_id,
        userId,
        item.id,
        payload.rating,
        payload.title || null,
        payload.comment || null,
        payload.images || [],
      ],
    );

    await client.query(
      `UPDATE order_items SET is_reviewed = true WHERE id = $1::uuid`,
      [item.id],
    );

    await refreshRatings(client, item.product_id, item.store_id);

    return created.rows[0];
  });

  await enqueueNotifications({
    user_id: item.vendor_id,
    type: "REVIEW_RECEIVED",
    title: `New ${payload.rating}-star review`,
    body: `A buyer reviewed "${item.title}".`,
    data: {
      review_id: review.id,
      product_id: item.product_id,
      rating: payload.rating,
    },
  });

  return review;
};

// Reviews for one product, with the star breakdown a product page needs
const productReviews = async (productId: string, filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const rating = filters.rating ? parseInt(filters.rating) : null;

  const reviewsResult = await query(
    `
        SELECT
            r.id,
            r.rating,
            r.title,
            r.comment,
            r.images,
            r.is_verified_purchase,
            r.vendor_reply,
            r.vendor_replied_at,
            r."createdAt" as "createdAt",
            json_build_object(
                'id', u.id,
                'name', u.name,
                'avatar', u.avatar
            ) as reviewer
        FROM reviews r
        INNER JOIN users u ON r.user_id = u.id
        WHERE r.product_id = $1::uuid
            AND r.status = 'PUBLISHED'::"ReviewStatus"
            AND ($2::int IS NULL OR r.rating = $2::int)
        ORDER BY r."createdAt" DESC
        LIMIT $3 OFFSET $4
    `,
    [productId, rating, limit, offset],
  );

  const summaryResult = await query(
    `
        SELECT
            COUNT(*) as total,
            COALESCE(ROUND(AVG(rating)::numeric, 2), 0) as average,
            COUNT(*) FILTER (WHERE rating = 5) as five,
            COUNT(*) FILTER (WHERE rating = 4) as four,
            COUNT(*) FILTER (WHERE rating = 3) as three,
            COUNT(*) FILTER (WHERE rating = 2) as two,
            COUNT(*) FILTER (WHERE rating = 1) as one
        FROM reviews
        WHERE product_id = $1::uuid AND status = 'PUBLISHED'::"ReviewStatus"
    `,
    [productId],
  );

  const summary = summaryResult.rows[0];
  const total = parseInt(rating ? "0" : summary.total);

  // When filtering by star the count has to come from the filtered set
  const filteredTotal = rating
    ? parseInt(
        (
          await query(
            `
                SELECT COUNT(*) as total FROM reviews
                WHERE product_id = $1::uuid
                    AND status = 'PUBLISHED'::"ReviewStatus"
                    AND rating = $2::int
            `,
            [productId, rating],
          )
        ).rows[0].total,
      )
    : total;

  const totalPage = Math.ceil(filteredTotal / limit);

  return {
    meta: {
      page,
      limit,
      total: filteredTotal,
      totalPage,
      hasNextPage: page < totalPage,
      hasPrevPage: page > 1,
    },
    summary: {
      total: parseInt(summary.total),
      average: Number(summary.average),
      breakdown: {
        5: parseInt(summary.five),
        4: parseInt(summary.four),
        3: parseInt(summary.three),
        2: parseInt(summary.two),
        1: parseInt(summary.one),
      },
    },
    data: reviewsResult.rows,
  };
};

// My Reviews
const myReviews = async (userId: string, filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;

  const result = await query(
    `
        SELECT
            r.*,
            json_build_object(
                'id', p.id,
                'title', p.title,
                'slug', p.slug,
                'thumbnail', p.thumbnail
            ) as product,
            json_build_object(
                'id', s.id,
                'name', s.name,
                'slug', s.slug
            ) as store
        FROM reviews r
        INNER JOIN products p ON r.product_id = p.id
        INNER JOIN stores s ON r.store_id = s.id
        WHERE r.user_id = $1::uuid
        ORDER BY r."createdAt" DESC
        LIMIT $2 OFFSET $3
    `,
    [userId, limit, offset],
  );

  const countResult = await query(
    `SELECT COUNT(*) as total FROM reviews WHERE user_id = $1::uuid`,
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
    data: result.rows,
  };
};

// Update my own review
const updateReview = async (
  userId: string,
  reviewId: string,
  payload: any,
) => {
  const reviewResult = await query(
    `SELECT * FROM reviews WHERE id = $1::uuid AND user_id = $2::uuid`,
    [reviewId, userId],
  );

  if (reviewResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Review not found.");
  }

  const review = reviewResult.rows[0];

  // Build dynamic update query
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (payload.rating !== undefined) {
    updates.push(`rating = $${paramCount++}`);
    values.push(payload.rating);
  }

  if (payload.title !== undefined) {
    updates.push(`title = $${paramCount++}`);
    values.push(payload.title);
  }

  if (payload.comment !== undefined) {
    updates.push(`comment = $${paramCount++}`);
    values.push(payload.comment);
  }

  if (payload.images !== undefined) {
    updates.push(`images = $${paramCount++}`);
    values.push(payload.images);
  }

  if (updates.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No fields to update");
  }

  updates.push(`"updatedAt" = CURRENT_TIMESTAMP`);
  values.push(reviewId);

  const updated = await transaction(async (client) => {
    const result = await client.query(
      `
            UPDATE reviews
            SET ${updates.join(", ")}
            WHERE id = $${paramCount}::uuid
            RETURNING *
        `,
      values,
    );

    await refreshRatings(client, review.product_id, review.store_id);

    return result.rows[0];
  });

  return updated;
};

// Delete my own review
const deleteReview = async (userId: string, reviewId: string) => {
  const reviewResult = await query(
    `SELECT * FROM reviews WHERE id = $1::uuid AND user_id = $2::uuid`,
    [reviewId, userId],
  );

  if (reviewResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Review not found.");
  }

  const review = reviewResult.rows[0];

  await transaction(async (client) => {
    await client.query(`DELETE FROM reviews WHERE id = $1::uuid`, [reviewId]);

    // Free the item up so the buyer can review it again
    await client.query(
      `UPDATE order_items SET is_reviewed = false WHERE id = $1::uuid`,
      [review.order_item_id],
    );

    await refreshRatings(client, review.product_id, review.store_id);
  });

  return null;
};

// Reviews received by the logged in vendor's store
const vendorReviews = async (userId: string, filters: any) => {
  const store = await getVendorStore(userId);

  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const rating = filters.rating ? parseInt(filters.rating) : null;
  const unrepliedOnly = filters.unreplied === "true";

  const result = await query(
    `
        SELECT
            r.*,
            json_build_object(
                'id', p.id,
                'title', p.title,
                'slug', p.slug,
                'thumbnail', p.thumbnail
            ) as product,
            json_build_object(
                'id', u.id,
                'name', u.name,
                'avatar', u.avatar
            ) as reviewer
        FROM reviews r
        INNER JOIN products p ON r.product_id = p.id
        INNER JOIN users u ON r.user_id = u.id
        WHERE r.store_id = $1::uuid
            AND ($2::int IS NULL OR r.rating = $2::int)
            AND ($3::boolean IS FALSE OR r.vendor_reply IS NULL)
        ORDER BY r."createdAt" DESC
        LIMIT $4 OFFSET $5
    `,
    [store.id, rating, unrepliedOnly, limit, offset],
  );

  const countResult = await query(
    `
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE vendor_reply IS NULL) as unreplied,
            COALESCE(ROUND(AVG(rating)::numeric, 2), 0) as average
        FROM reviews
        WHERE store_id = $1::uuid
            AND ($2::int IS NULL OR rating = $2::int)
            AND ($3::boolean IS FALSE OR vendor_reply IS NULL)
    `,
    [store.id, rating, unrepliedOnly],
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
    summary: {
      unreplied: parseInt(countResult.rows[0].unreplied),
      average: Number(countResult.rows[0].average),
    },
    data: result.rows,
  };
};

// Vendor replies to a review
const replyToReview = async (
  userId: string,
  reviewId: string,
  payload: any,
) => {
  const store = await getVendorStore(userId);

  const reviewResult = await query(
    `SELECT * FROM reviews WHERE id = $1::uuid AND store_id = $2::uuid`,
    [reviewId, store.id],
  );

  if (reviewResult.rows.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "Review not found for your store.",
    );
  }

  const result = await query(
    `
        UPDATE reviews
        SET
            vendor_reply = $1,
            vendor_replied_at = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $2::uuid
        RETURNING *
    `,
    [payload.reply, reviewId],
  );

  await enqueueNotifications({
    user_id: reviewResult.rows[0].user_id,
    type: "REVIEW_REPLY",
    title: `${store.name} replied to your review`,
    body: payload.reply.slice(0, 180),
    data: { review_id: reviewId, store_id: store.id },
  });

  return result.rows[0];
};

// Every review, for admin moderation
const allReviewsForAdmin = async (filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const status = filters.status || null;
  const rating = filters.rating ? parseInt(filters.rating) : null;

  const result = await query(
    `
        SELECT
            r.*,
            json_build_object(
                'id', p.id,
                'title', p.title,
                'slug', p.slug,
                'thumbnail', p.thumbnail
            ) as product,
            json_build_object(
                'id', s.id,
                'name', s.name,
                'slug', s.slug
            ) as store,
            json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email
            ) as reviewer
        FROM reviews r
        INNER JOIN products p ON r.product_id = p.id
        INNER JOIN stores s ON r.store_id = s.id
        INNER JOIN users u ON r.user_id = u.id
        WHERE ($1::text IS NULL OR r.status = $1::"ReviewStatus")
            AND ($2::int IS NULL OR r.rating = $2::int)
        ORDER BY r."createdAt" DESC
        LIMIT $3 OFFSET $4
    `,
    [status, rating, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM reviews r
        WHERE ($1::text IS NULL OR r.status = $1::"ReviewStatus")
            AND ($2::int IS NULL OR r.rating = $2::int)
    `,
    [status, rating],
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

// Publish or reject a review - admin
const updateReviewStatus = async (reviewId: string, payload: any) => {
  const reviewResult = await query(`SELECT * FROM reviews WHERE id = $1::uuid`, [
    reviewId,
  ]);

  if (reviewResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Review not found.");
  }

  if (payload.status === "REJECTED" && !payload.rejection_reason) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "A reason is required when rejecting a review.",
    );
  }

  const review = reviewResult.rows[0];

  const updated = await transaction(async (client) => {
    const result = await client.query(
      `
            UPDATE reviews
            SET
                status = $1::"ReviewStatus",
                rejection_reason = $2,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $3::uuid
            RETURNING *
        `,
      [
        payload.status,
        payload.status === "REJECTED" ? payload.rejection_reason : null,
        reviewId,
      ],
    );

    // A moderated review changes the averages buyers see
    await refreshRatings(client, review.product_id, review.store_id);

    return result.rows[0];
  });

  return updated;
};

export const ReviewService = {
  createReview,
  reviewableItems,
  productReviews,
  myReviews,
  updateReview,
  deleteReview,
  vendorReviews,
  replyToReview,
  allReviewsForAdmin,
  updateReviewStatus,
};
