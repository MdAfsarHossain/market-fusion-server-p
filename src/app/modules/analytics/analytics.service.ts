import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { query } from "../../utils/db";
import { resolveStoreFor } from "../../utils/storeAccess";

// Only money that actually arrived counts as revenue
const PAID_ONLY = `o.payment_status = 'PAID'::"PaymentStatus"`;

// Resolve the reporting window. Everything is inclusive of `from` and exclusive
// of the day after `to`, so a single day range still returns that day.
const resolveRange = (filters: any) => {
  const days = Math.min(Math.max(parseInt(filters.days) || 30, 1), 365);

  const to = filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : new Date();
  const from = filters.from
    ? new Date(`${filters.from}T00:00:00.000Z`)
    : new Date(to.getTime() - (days - 1) * 86_400_000);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Those dates are not valid.");
  }

  if (from > to) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "The start date must be before the end date.",
    );
  }

  return { from, to, days };
};

// ─── Vendor ──────────────────────────────────────────────────────────────────

const vendorOverview = async (userId: string, filters: any) => {
  const access = await resolveStoreFor(userId, "ANALYTICS");
  const storeId = access.store.id;
  const { from, to } = resolveRange(filters);

  const totals = await query(
    `
        SELECT
            COUNT(DISTINCT so.id) as orders,
            COALESCE(SUM(so.subtotal), 0) as gross,
            COALESCE(SUM(so.discount_total), 0) as discounts,
            COALESCE(SUM(so.commission_amount), 0) as commission,
            COALESCE(SUM(so.vendor_earning), 0) as earnings,
            COUNT(DISTINCT o.user_id) as customers
        FROM sub_orders so
        INNER JOIN orders o ON so.order_id = o.id
        WHERE so.store_id = $1::uuid
            AND ${PAID_ONLY}
            AND so."createdAt" BETWEEN $2 AND $3
    `,
    [storeId, from, to],
  );

  const units = await query(
    `
        SELECT
            COALESCE(SUM(oi.quantity), 0) as units,
            COUNT(*) as line_items
        FROM order_items oi
        INNER JOIN orders o ON oi.order_id = o.id
        WHERE oi.store_id = $1::uuid
            AND ${PAID_ONLY}
            AND oi."createdAt" BETWEEN $2 AND $3
    `,
    [storeId, from, to],
  );

  // Compare with the window immediately before, so the numbers have context
  const spanMs = to.getTime() - from.getTime();
  const previousFrom = new Date(from.getTime() - spanMs - 1);
  const previousTo = new Date(from.getTime() - 1);

  const previous = await query(
    `
        SELECT
            COUNT(DISTINCT so.id) as orders,
            COALESCE(SUM(so.vendor_earning), 0) as earnings
        FROM sub_orders so
        INNER JOIN orders o ON so.order_id = o.id
        WHERE so.store_id = $1::uuid
            AND ${PAID_ONLY}
            AND so."createdAt" BETWEEN $2 AND $3
    `,
    [storeId, previousFrom, previousTo],
  );

  const statusBreakdown = await query(
    `
        SELECT so.status, COUNT(*) as total
        FROM sub_orders so
        WHERE so.store_id = $1::uuid AND so."createdAt" BETWEEN $2 AND $3
        GROUP BY so.status
    `,
    [storeId, from, to],
  );

  const catalogue = await query(
    `
        SELECT
            COUNT(*) as total_products,
            COUNT(*) FILTER (WHERE status = 'PUBLISHED'::"ProductStatus") as published,
            COUNT(*) FILTER (WHERE type = 'PHYSICAL'::"ProductType" AND has_variants = false AND stock <= low_stock_threshold) as low_stock,
            COALESCE(ROUND(AVG(rating) FILTER (WHERE total_reviews > 0), 2), 0) as avg_rating
        FROM products
        WHERE store_id = $1::uuid
    `,
    [storeId],
  );

  const row = totals.rows[0];
  const prev = previous.rows[0];

  const percentChange = (current: number, before: number) => {
    if (before === 0) return current > 0 ? 100 : 0;
    return Number((((current - before) / before) * 100).toFixed(1));
  };

  return {
    range: { from, to },
    totals: {
      orders: parseInt(row.orders),
      gross: Number(row.gross),
      discounts: Number(row.discounts),
      commission: Number(row.commission),
      earnings: Number(row.earnings),
      customers: parseInt(row.customers),
      units: parseInt(units.rows[0].units),
      average_order_value:
        parseInt(row.orders) > 0
          ? Number((Number(row.gross) / parseInt(row.orders)).toFixed(2))
          : 0,
    },
    change: {
      orders: percentChange(parseInt(row.orders), parseInt(prev.orders)),
      earnings: percentChange(Number(row.earnings), Number(prev.earnings)),
    },
    order_status: statusBreakdown.rows.reduce(
      (acc: Record<string, number>, item: any) => {
        acc[item.status] = parseInt(item.total);
        return acc;
      },
      {},
    ),
    catalogue: {
      total_products: parseInt(catalogue.rows[0].total_products),
      published: parseInt(catalogue.rows[0].published),
      low_stock: parseInt(catalogue.rows[0].low_stock),
      average_rating: Number(catalogue.rows[0].avg_rating),
    },
  };
};

// Revenue per day, with empty days filled in so a chart has no gaps
const vendorRevenueSeries = async (userId: string, filters: any) => {
  const access = await resolveStoreFor(userId, "ANALYTICS");
  const { from, to } = resolveRange(filters);

  const result = await query(
    `
        SELECT
            day::date as date,
            COALESCE(agg.orders, 0) as orders,
            COALESCE(agg.gross, 0) as gross,
            COALESCE(agg.earnings, 0) as earnings
        FROM generate_series($2::date, $3::date, interval '1 day') as day
        LEFT JOIN (
            SELECT
                so."createdAt"::date as date,
                COUNT(DISTINCT so.id) as orders,
                SUM(so.subtotal) as gross,
                SUM(so.vendor_earning) as earnings
            FROM sub_orders so
            INNER JOIN orders o ON so.order_id = o.id
            WHERE so.store_id = $1::uuid
                AND ${PAID_ONLY}
                AND so."createdAt" BETWEEN $2 AND $3
            GROUP BY so."createdAt"::date
        ) agg ON agg.date = day::date
        ORDER BY day ASC
    `,
    [access.store.id, from, to],
  );

  return {
    range: { from, to },
    series: result.rows.map((row: any) => ({
      date: row.date,
      orders: parseInt(row.orders),
      gross: Number(row.gross),
      earnings: Number(row.earnings),
    })),
  };
};

// What actually sells
const vendorTopProducts = async (userId: string, filters: any) => {
  const access = await resolveStoreFor(userId, "ANALYTICS");
  const { from, to } = resolveRange(filters);
  const limit = Math.min(parseInt(filters.limit) || 10, 50);

  const result = await query(
    `
        SELECT
            oi.product_id,
            oi.title,
            oi.type,
            oi.thumbnail,
            p.slug,
            SUM(oi.quantity) as units,
            SUM(oi.line_total) as revenue,
            COUNT(DISTINCT oi.order_id) as orders
        FROM order_items oi
        INNER JOIN orders o ON oi.order_id = o.id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.store_id = $1::uuid
            AND ${PAID_ONLY}
            AND oi."createdAt" BETWEEN $2 AND $3
        GROUP BY oi.product_id, oi.title, oi.type, oi.thumbnail, p.slug
        ORDER BY revenue DESC
        LIMIT $4
    `,
    [access.store.id, from, to, limit],
  );

  return {
    range: { from, to },
    products: result.rows.map((row: any) => ({
      ...row,
      units: parseInt(row.units),
      orders: parseInt(row.orders),
      revenue: Number(row.revenue),
    })),
  };
};

// Revenue split by what kind of thing was sold, which is the whole point of a
// hybrid marketplace
const vendorSalesByType = async (userId: string, filters: any) => {
  const access = await resolveStoreFor(userId, "ANALYTICS");
  const { from, to } = resolveRange(filters);

  const result = await query(
    `
        SELECT
            oi.type,
            COUNT(*) as line_items,
            SUM(oi.quantity) as units,
            SUM(oi.line_total) as revenue
        FROM order_items oi
        INNER JOIN orders o ON oi.order_id = o.id
        WHERE oi.store_id = $1::uuid
            AND ${PAID_ONLY}
            AND oi."createdAt" BETWEEN $2 AND $3
        GROUP BY oi.type
        ORDER BY revenue DESC
    `,
    [access.store.id, from, to],
  );

  return {
    range: { from, to },
    types: result.rows.map((row: any) => ({
      type: row.type,
      line_items: parseInt(row.line_items),
      units: parseInt(row.units),
      revenue: Number(row.revenue),
    })),
  };
};

// ─── Admin ───────────────────────────────────────────────────────────────────

const adminOverview = async (filters: any) => {
  const { from, to } = resolveRange(filters);

  const totals = await query(
    `
        SELECT
            COUNT(DISTINCT o.id) as orders,
            COALESCE(SUM(o.subtotal), 0) as gmv,
            COALESCE(SUM(o.discount_total), 0) as discounts,
            COUNT(DISTINCT o.user_id) as buyers
        FROM orders o
        WHERE ${PAID_ONLY} AND o."createdAt" BETWEEN $1 AND $2
    `,
    [from, to],
  );

  const commission = await query(
    `
        SELECT
            COALESCE(SUM(so.commission_amount), 0) as commission,
            COALESCE(SUM(so.vendor_earning), 0) as vendor_earnings,
            COUNT(DISTINCT so.store_id) as selling_stores
        FROM sub_orders so
        INNER JOIN orders o ON so.order_id = o.id
        WHERE ${PAID_ONLY} AND so."createdAt" BETWEEN $1 AND $2
    `,
    [from, to],
  );

  const platform = await query(
    `
        SELECT
            (SELECT COUNT(*) FROM stores) as stores_total,
            (SELECT COUNT(*) FROM stores WHERE status = 'ACTIVE'::"StoreStatus") as stores_active,
            (SELECT COUNT(*) FROM stores WHERE status = 'PENDING'::"StoreStatus") as stores_pending,
            (SELECT COUNT(*) FROM products WHERE status = 'PUBLISHED'::"ProductStatus") as products_published,
            (SELECT COUNT(*) FROM products WHERE status = 'PENDING'::"ProductStatus") as products_pending,
            (SELECT COUNT(*) FROM users WHERE role IN ('USER'::"Role", 'VENDOR'::"Role")) as users_total,
            (SELECT COUNT(*) FROM reviews WHERE status = 'PUBLISHED'::"ReviewStatus") as reviews_published,
            (SELECT COALESCE(SUM(amount), 0) FROM withdrawal_requests WHERE status = 'PENDING'::"WithdrawalStatus") as withdrawals_pending
    `,
  );

  const row = totals.rows[0];
  const commissionRow = commission.rows[0];

  return {
    range: { from, to },
    totals: {
      orders: parseInt(row.orders),
      gmv: Number(row.gmv),
      discounts: Number(row.discounts),
      buyers: parseInt(row.buyers),
      commission: Number(commissionRow.commission),
      vendor_earnings: Number(commissionRow.vendor_earnings),
      selling_stores: parseInt(commissionRow.selling_stores),
      average_order_value:
        parseInt(row.orders) > 0
          ? Number((Number(row.gmv) / parseInt(row.orders)).toFixed(2))
          : 0,
    },
    platform: {
      stores_total: parseInt(platform.rows[0].stores_total),
      stores_active: parseInt(platform.rows[0].stores_active),
      stores_pending: parseInt(platform.rows[0].stores_pending),
      products_published: parseInt(platform.rows[0].products_published),
      products_pending: parseInt(platform.rows[0].products_pending),
      users_total: parseInt(platform.rows[0].users_total),
      reviews_published: parseInt(platform.rows[0].reviews_published),
      withdrawals_pending: Number(platform.rows[0].withdrawals_pending),
    },
  };
};

const adminRevenueSeries = async (filters: any) => {
  const { from, to } = resolveRange(filters);

  const result = await query(
    `
        SELECT
            day::date as date,
            COALESCE(agg.orders, 0) as orders,
            COALESCE(agg.gmv, 0) as gmv,
            COALESCE(comm.commission, 0) as commission
        FROM generate_series($1::date, $2::date, interval '1 day') as day
        LEFT JOIN (
            SELECT
                o."createdAt"::date as date,
                COUNT(*) as orders,
                SUM(o.subtotal) as gmv
            FROM orders o
            WHERE ${PAID_ONLY} AND o."createdAt" BETWEEN $1 AND $2
            GROUP BY o."createdAt"::date
        ) agg ON agg.date = day::date
        -- Commission lives on the vendor splits, so it is rolled up separately
        -- rather than nested inside the order aggregate
        LEFT JOIN (
            SELECT
                so."createdAt"::date as date,
                SUM(so.commission_amount) as commission
            FROM sub_orders so
            INNER JOIN orders o ON so.order_id = o.id
            WHERE ${PAID_ONLY} AND so."createdAt" BETWEEN $1 AND $2
            GROUP BY so."createdAt"::date
        ) comm ON comm.date = day::date
        ORDER BY day ASC
    `,
    [from, to],
  );

  return {
    range: { from, to },
    series: result.rows.map((row: any) => ({
      date: row.date,
      orders: parseInt(row.orders),
      gmv: Number(row.gmv),
      commission: Number(row.commission),
    })),
  };
};

const adminTopStores = async (filters: any) => {
  const { from, to } = resolveRange(filters);
  const limit = Math.min(parseInt(filters.limit) || 10, 50);

  const result = await query(
    `
        SELECT
            s.id,
            s.name,
            s.slug,
            s.logo,
            s.rating,
            COUNT(DISTINCT so.id) as orders,
            COALESCE(SUM(so.subtotal), 0) as gross,
            COALESCE(SUM(so.commission_amount), 0) as commission
        FROM sub_orders so
        INNER JOIN orders o ON so.order_id = o.id
        INNER JOIN stores s ON so.store_id = s.id
        WHERE ${PAID_ONLY} AND so."createdAt" BETWEEN $1 AND $2
        GROUP BY s.id, s.name, s.slug, s.logo, s.rating
        ORDER BY gross DESC
        LIMIT $3
    `,
    [from, to, limit],
  );

  return {
    range: { from, to },
    stores: result.rows.map((row: any) => ({
      ...row,
      orders: parseInt(row.orders),
      gross: Number(row.gross),
      commission: Number(row.commission),
    })),
  };
};

const adminSalesByType = async (filters: any) => {
  const { from, to } = resolveRange(filters);

  const result = await query(
    `
        SELECT
            oi.type,
            COUNT(*) as line_items,
            SUM(oi.quantity) as units,
            SUM(oi.line_total) as revenue
        FROM order_items oi
        INNER JOIN orders o ON oi.order_id = o.id
        WHERE ${PAID_ONLY} AND oi."createdAt" BETWEEN $1 AND $2
        GROUP BY oi.type
        ORDER BY revenue DESC
    `,
    [from, to],
  );

  return {
    range: { from, to },
    types: result.rows.map((row: any) => ({
      type: row.type,
      line_items: parseInt(row.line_items),
      units: parseInt(row.units),
      revenue: Number(row.revenue),
    })),
  };
};

export const AnalyticsService = {
  vendorOverview,
  vendorRevenueSeries,
  vendorTopProducts,
  vendorSalesByType,
  adminOverview,
  adminRevenueSeries,
  adminTopStores,
  adminSalesByType,
};
