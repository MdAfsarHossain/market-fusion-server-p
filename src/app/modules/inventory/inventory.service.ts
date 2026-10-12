import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { resolveStoreFor } from "../../utils/storeAccess";
import { query, transaction } from "../../utils/db";
import { enqueueNotifications } from "../../queues/notification.queue";

// Resolve the store this user acts for. Delegates to the shared resolver so
// an owner and a permitted staff member reach the same store, and a staff
// member without INVENTORY access is refused here rather than deeper in.
const getVendorStore = async (userId: string) => {
  const access = await resolveStoreFor(userId, "INVENTORY", {
    requireActive: false,
  });

  return access.store;
};

// Record a stock change. Call this from inside the transaction that actually
// moved the stock, so the ledger can never disagree with the counts.
const recordMovement = async (
  client: any,
  input: {
    productId: string;
    variantId?: string | null;
    storeId: string;
    type: string;
    quantityChange: number;
    quantityAfter: number;
    referenceType?: string | null;
    referenceId?: string | null;
    note?: string | null;
    createdBy?: string | null;
  },
) => {
  await client.query(
    `
        INSERT INTO inventory_movements (
            product_id,
            variant_id,
            store_id,
            type,
            quantity_change,
            quantity_after,
            reference_type,
            reference_id,
            note,
            created_by,
            "createdAt"
        ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::"InventoryMovementType",
            $5, $6, $7, $8::uuid, $9, $10::uuid, CURRENT_TIMESTAMP
        )
    `,
    [
      input.productId,
      input.variantId || null,
      input.storeId,
      input.type,
      input.quantityChange,
      input.quantityAfter,
      input.referenceType || null,
      input.referenceId || null,
      input.note || null,
      input.createdBy || null,
    ],
  );
};

// Look at the stock that just changed and warn the vendor if it is running out.
// Returns the notification payloads so the caller can enqueue them after its
// transaction commits.
const collectLowStockAlerts = async (
  client: any,
  productIds: string[],
) => {
  if (!productIds.length) {
    return [];
  }

  const result = await client.query(
    `
        SELECT
            p.id,
            p.title,
            p.stock,
            p.low_stock_threshold,
            s.owner_id,
            s.name as store_name
        FROM products p
        INNER JOIN stores s ON p.store_id = s.id
        WHERE p.id = ANY($1::uuid[])
            AND p.type = 'PHYSICAL'::"ProductType"
            AND p.has_variants = false
            AND p.stock <= p.low_stock_threshold
    `,
    [productIds],
  );

  return result.rows.map((row: any) => ({
    user_id: row.owner_id,
    type: "LOW_STOCK",
    title: row.stock <= 0 ? "Out of stock" : "Low stock",
    body:
      row.stock <= 0
        ? `"${row.title}" is out of stock.`
        : `"${row.title}" has only ${row.stock} left.`,
    data: { product_id: row.id, stock: row.stock },
  }));
};

// Inventory overview for the vendor's own catalogue
const myInventory = async (userId: string, filters: any) => {
  const store = await getVendorStore(userId);

  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 20;
  const offset = (page - 1) * limit;
  const searchTerm = filters.searchTerm || null;
  const lowOnly = filters.low_stock === "true";

  const result = await query(
    `
        SELECT
            p.id,
            p.title,
            p.slug,
            p.thumbnail,
            p.sku,
            p.type,
            p.stock,
            p.low_stock_threshold,
            p.has_variants,
            p.status,
            p.total_sold,
            (p.stock <= p.low_stock_threshold) as is_low_stock,
            (
                SELECT COALESCE(json_agg(
                    json_build_object(
                        'id', pv.id,
                        'name', pv.name,
                        'sku', pv.sku,
                        'stock', pv.stock,
                        'is_active', pv.is_active
                    ) ORDER BY pv."createdAt" ASC
                ), '[]'::json)
                FROM product_variants pv WHERE pv.product_id = p.id
            ) as variants
        FROM products p
        WHERE p.store_id = $1::uuid
            AND p.type = 'PHYSICAL'::"ProductType"
            AND ($2::text IS NULL OR p.title ILIKE '%' || $2 || '%' OR p.sku ILIKE '%' || $2 || '%')
            AND ($3::boolean IS FALSE OR p.stock <= p.low_stock_threshold)
        ORDER BY p.stock ASC, p.title ASC
        LIMIT $4 OFFSET $5
    `,
    [store.id, searchTerm, lowOnly, limit, offset],
  );

  const summaryResult = await query(
    `
        SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE stock <= low_stock_threshold AND stock > 0) as low_stock,
            COUNT(*) FILTER (WHERE stock <= 0) as out_of_stock,
            COALESCE(SUM(stock), 0) as total_units
        FROM products
        WHERE store_id = $1::uuid AND type = 'PHYSICAL'::"ProductType"
    `,
    [store.id],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM products p
        WHERE p.store_id = $1::uuid
            AND p.type = 'PHYSICAL'::"ProductType"
            AND ($2::text IS NULL OR p.title ILIKE '%' || $2 || '%' OR p.sku ILIKE '%' || $2 || '%')
            AND ($3::boolean IS FALSE OR p.stock <= p.low_stock_threshold)
    `,
    [store.id, searchTerm, lowOnly],
  );

  const total = parseInt(countResult.rows[0].total);
  const totalPage = Math.ceil(total / limit);
  const summary = summaryResult.rows[0];

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
      total_products: parseInt(summary.total),
      low_stock: parseInt(summary.low_stock),
      out_of_stock: parseInt(summary.out_of_stock),
      total_units: parseInt(summary.total_units),
    },
    data: result.rows,
  };
};

// Adjust stock by a relative amount, or restock to an absolute figure
const adjustStock = async (userId: string, payload: any) => {
  const store = await getVendorStore(userId);

  const productResult = await query(
    `
        SELECT id, title, type, stock, has_variants
        FROM products
        WHERE id = $1::uuid AND store_id = $2::uuid
    `,
    [payload.product_id, store.id],
  );

  if (productResult.rows.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "Product not found in your store.",
    );
  }

  const product = productResult.rows[0];

  if (product.type !== "PHYSICAL") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Only a physical product tracks stock.",
    );
  }

  // A variant's stock lives on the variant row, not the product
  if (payload.variant_id) {
    const variantResult = await query(
      `
            SELECT id, name, stock FROM product_variants
            WHERE id = $1::uuid AND product_id = $2::uuid
        `,
      [payload.variant_id, product.id],
    );

    if (variantResult.rows.length === 0) {
      throw new ApiError(httpStatus.NOT_FOUND, "Variant not found.");
    }
  } else if (product.has_variants) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This product uses variants, so please adjust the stock of a variant.",
    );
  }

  const isAbsolute = payload.mode === "SET";

  const { updated, alerts } = await transaction(async (client) => {
    const target = payload.variant_id
      ? { table: "product_variants", id: payload.variant_id }
      : { table: "products", id: product.id };

    const locked = await client.query(
      `SELECT id, stock FROM ${target.table} WHERE id = $1::uuid FOR UPDATE`,
      [target.id],
    );

    const currentStock = locked.rows[0].stock;
    const newStock = isAbsolute
      ? Number(payload.quantity)
      : currentStock + Number(payload.quantity);

    if (newStock < 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `That would take the stock below zero. Current stock is ${currentStock}.`,
      );
    }

    const result = await client.query(
      `
            UPDATE ${target.table}
            SET stock = $1, "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $2::uuid
            RETURNING id, stock
        `,
      [newStock, target.id],
    );

    await recordMovement(client, {
      productId: product.id,
      variantId: payload.variant_id || null,
      storeId: store.id,
      type: isAbsolute ? "RESTOCK" : "ADJUSTMENT",
      quantityChange: newStock - currentStock,
      quantityAfter: newStock,
      referenceType: "manual",
      note: payload.note || null,
      createdBy: userId,
    });

    const lowStockAlerts = await collectLowStockAlerts(client, [product.id]);

    return { updated: result.rows[0], alerts: lowStockAlerts };
  });

  await enqueueNotifications(alerts);

  return {
    product_id: product.id,
    variant_id: payload.variant_id || null,
    stock: updated.stock,
  };
};

// Set the threshold that marks a product as low on stock
const updateLowStockThreshold = async (userId: string, payload: any) => {
  const store = await getVendorStore(userId);

  const result = await query(
    `
        UPDATE products
        SET low_stock_threshold = $1, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $2::uuid AND store_id = $3::uuid
        RETURNING id, title, stock, low_stock_threshold
    `,
    [payload.low_stock_threshold, payload.product_id, store.id],
  );

  if (result.rows.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "Product not found in your store.",
    );
  }

  return result.rows[0];
};

// The audit trail for one product, or for the whole store
const movements = async (userId: string, filters: any) => {
  const store = await getVendorStore(userId);

  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 20;
  const offset = (page - 1) * limit;
  const productId = filters.product_id || null;
  const type = filters.type || null;

  const result = await query(
    `
        SELECT
            im.*,
            json_build_object(
                'id', p.id,
                'title', p.title,
                'thumbnail', p.thumbnail
            ) as product,
            CASE WHEN pv.id IS NULL THEN NULL ELSE json_build_object(
                'id', pv.id,
                'name', pv.name
            ) END as variant
        FROM inventory_movements im
        INNER JOIN products p ON im.product_id = p.id
        LEFT JOIN product_variants pv ON im.variant_id = pv.id
        WHERE im.store_id = $1::uuid
            AND ($2::uuid IS NULL OR im.product_id = $2::uuid)
            AND ($3::text IS NULL OR im.type = $3::"InventoryMovementType")
        ORDER BY im."createdAt" DESC
        LIMIT $4 OFFSET $5
    `,
    [store.id, productId, type, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM inventory_movements im
        WHERE im.store_id = $1::uuid
            AND ($2::uuid IS NULL OR im.product_id = $2::uuid)
            AND ($3::text IS NULL OR im.type = $3::"InventoryMovementType")
    `,
    [store.id, productId, type],
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

// Low stock across the whole marketplace, for admin
const lowStockForAdmin = async (filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 20;
  const offset = (page - 1) * limit;

  const result = await query(
    `
        SELECT
            p.id,
            p.title,
            p.slug,
            p.thumbnail,
            p.stock,
            p.low_stock_threshold,
            json_build_object(
                'id', s.id,
                'name', s.name,
                'slug', s.slug
            ) as store
        FROM products p
        INNER JOIN stores s ON p.store_id = s.id
        WHERE p.type = 'PHYSICAL'::"ProductType"
            AND p.has_variants = false
            AND p.stock <= p.low_stock_threshold
            AND p.status = 'PUBLISHED'::"ProductStatus"
        ORDER BY p.stock ASC
        LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM products p
        WHERE p.type = 'PHYSICAL'::"ProductType"
            AND p.has_variants = false
            AND p.stock <= p.low_stock_threshold
            AND p.status = 'PUBLISHED'::"ProductStatus"
    `,
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

export const InventoryService = {
  myInventory,
  adjustStock,
  updateLowStockThreshold,
  movements,
  lowStockForAdmin,
  // Used by the order module
  recordMovement,
  collectLowStockAlerts,
};
