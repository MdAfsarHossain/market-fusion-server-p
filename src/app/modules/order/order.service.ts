import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { resolveStoreFor } from "../../utils/storeAccess";
import { query, transaction } from "../../utils/db";
import { CouponService } from "../coupon/coupon.service";
import { InventoryService } from "../inventory/inventory.service";
import { WalletService } from "../wallet/wallet.service";
import { RentalService } from "../rental/rental.service";
import { ServiceBookingService } from "../service/service.service";
import { enqueueNotifications } from "../../queues/notification.queue";

// Human readable, collision resistant order reference
const generateOrderNumber = () => {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MF-${stamp}-${random}`;
};

// Money helper - keeps every total at two decimals
const toMoney = (value: number) => Number(value.toFixed(2));

// Which status a sub order is allowed to move to next
const allowedStatusTransitions: Record<string, string[]> = {
  PENDING: ["CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["SHIPPED", "COMPLETED", "CANCELLED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
};

// Resolve the store this user acts for. Delegates to the shared resolver so
// an owner and a permitted staff member reach the same store, and a staff
// member without ORDERS access is refused here rather than deeper in.
const getVendorStore = async (userId: string) => {
  const access = await resolveStoreFor(userId, "ORDERS", {
    requireActive: false,
  });

  return access.store;
};

// Resolve the shipping address, either a saved one or an inline object
const resolveShippingAddress = async (userId: string, payload: any) => {
  if (payload.address_id) {
    const result = await query(
      `
            SELECT
                full_name,
                phone,
                address_line1,
                address_line2,
                city,
                state,
                postal_code,
                country
            FROM addresses
            WHERE id = $1::uuid AND user_id = $2::uuid
        `,
      [payload.address_id, userId],
    );

    if (result.rows.length === 0) {
      throw new ApiError(httpStatus.NOT_FOUND, "Address not found.");
    }

    return result.rows[0];
  }

  if (payload.shipping_address) {
    return payload.shipping_address;
  }

  throw new ApiError(
    httpStatus.BAD_REQUEST,
    "Either an address_id or a shipping_address is required.",
  );
};

// Load the cart lines and refuse checkout if anything is no longer sellable
const loadCheckoutLines = async (userId: string) => {
  const result = await query(
    `
        SELECT
            ci.id,
            ci.product_id,
            ci.variant_id,
            ci.store_id,
            ci.type,
            ci.quantity,
            ci.unit_price,
            ci.rental_start,
            ci.rental_end,
            ci.rental_units,
            ci.booking_start,
            p.title,
            p.thumbnail,
            p.sku as product_sku,
            p.stock as product_stock,
            p.status as product_status,
            p.is_active as product_is_active,
            p.currency,
            pv.name as variant_name,
            pv.sku as variant_sku,
            pv.stock as variant_stock,
            pv.is_active as variant_is_active,
            s.name as store_name,
            s.status as store_status,
            s.is_active as store_is_active,
            s.commission_rate,
            s.owner_id as store_owner_id,
            rp.security_deposit
        FROM cart_items ci
        INNER JOIN carts c ON ci.cart_id = c.id
        INNER JOIN products p ON ci.product_id = p.id
        INNER JOIN stores s ON ci.store_id = s.id
        LEFT JOIN product_variants pv ON ci.variant_id = pv.id
        LEFT JOIN rental_products rp ON rp.product_id = p.id
        WHERE c.user_id = $1::uuid
        ORDER BY ci.store_id, ci."createdAt" ASC
    `,
    [userId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Your cart is empty.");
  }

  result.rows.forEach((line: any) => {
    if (line.product_status !== "PUBLISHED" || !line.product_is_active) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `"${line.title}" is no longer available. Please remove it from your cart.`,
      );
    }

    if (line.store_status !== "ACTIVE" || !line.store_is_active) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `The store "${line.store_name}" is not accepting orders right now.`,
      );
    }

    if (line.variant_id && !line.variant_is_active) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `The selected option of "${line.title}" is no longer available.`,
      );
    }

    // Stock only constrains physical goods
    if (line.type === "PHYSICAL") {
      const available =
        line.variant_id !== null ? line.variant_stock : line.product_stock;

      if (available < line.quantity) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          `"${line.title}" only has ${available} item(s) left in stock.`,
        );
      }
    }
  });

  return result.rows;
};

// Checkout - turn the cart into one buyer order split into per vendor sub orders
const checkout = async (userId: string, payload: any) => {
  const shippingAddress = await resolveShippingAddress(userId, payload);
  const lines = await loadCheckoutLines(userId);

  const orderNumber = generateOrderNumber();
  const currency = lines[0].currency || "USD";

  // Group the cart lines by vendor
  const storeGroups = new Map<string, any[]>();
  lines.forEach((line: any) => {
    if (!storeGroups.has(line.store_id)) {
      storeGroups.set(line.store_id, []);
    }
    storeGroups.get(line.store_id)!.push(line);
  });

  // Coupon eligible amounts deliberately exclude rental deposits: a refundable
  // deposit is not a purchase, so discounting it would give money away.
  const couponLines = Array.from(storeGroups.entries()).map(
    ([storeId, storeLines]) => ({
      store_id: storeId,
      line_total: toMoney(
        storeLines.reduce(
          (sum, line: any) => sum + Number(line.unit_price) * line.quantity,
          0,
        ),
      ),
    }),
  );

  // Priced against the same rules the preview endpoint uses, so the buyer is
  // charged exactly what they were quoted.
  const appliedCoupon = payload.coupon_code
    ? await CouponService.validateCoupon(userId, payload.coupon_code, couponLines)
    : null;

  // A platform coupon is funded by the marketplace, so it must not shrink what
  // the vendor earns. A vendor's own coupon is theirs to absorb.
  const isPlatformCoupon = Boolean(appliedCoupon && !appliedCoupon.scopedStoreId);

  // Split the discount across the vendors it applies to. The last share takes
  // the remainder so the parts always add back up to the total discount.
  const discountByStore = new Map<string, number>();

  if (appliedCoupon) {
    const eligible = appliedCoupon.scopedStoreId
      ? couponLines.filter(
          (line) => line.store_id === appliedCoupon.scopedStoreId,
        )
      : couponLines;

    let remaining = appliedCoupon.discount;

    eligible.forEach((line, index) => {
      const share =
        index === eligible.length - 1
          ? remaining
          : toMoney(
              (appliedCoupon.discount * line.line_total) /
                appliedCoupon.eligibleSubtotal,
            );

      discountByStore.set(line.store_id, share);
      remaining = toMoney(remaining - share);
    });
  }

  // Collected inside the transaction, acted on only after it commits
  const reservedProductIds = new Set<string>();

  const { order, lowStockAlerts } = await transaction(async (client) => {
    let orderSubtotal = 0;

    const orderResult = await client.query(
      `
            INSERT INTO orders (
                order_number,
                user_id,
                currency,
                status,
                payment_status,
                shipping_address,
                billing_address,
                customer_note,
                placed_at,
                "createdAt",
                "updatedAt"
            ) VALUES (
                $1, $2::uuid, $3, 'PENDING'::"OrderStatus", 'PENDING'::"PaymentStatus",
                $4::jsonb, $5::jsonb, $6, CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING *
        `,
      [
        orderNumber,
        userId,
        currency,
        JSON.stringify(shippingAddress),
        JSON.stringify(payload.billing_address || shippingAddress),
        payload.customer_note || null,
      ],
    );

    const createdOrder = orderResult.rows[0];
    let storeIndex = 0;

    for (const [storeId, storeLines] of storeGroups) {
      storeIndex += 1;

      const commissionRate = Number(storeLines[0].commission_rate);
      let subOrderSubtotal = 0;

      // Phase 1 charges no shipping and no tax yet
      const subOrderShipping = 0;

      storeLines.forEach((line: any) => {
        subOrderSubtotal += Number(line.unit_price) * line.quantity;

        // A rental deposit is collected on top of the rental fee
        if (line.type === "RENTAL" && line.security_deposit) {
          subOrderSubtotal += Number(line.security_deposit) * line.quantity;
        }
      });

      subOrderSubtotal = toMoney(subOrderSubtotal);
      const storeDiscount = discountByStore.get(storeId) || 0;

      // Commission and earnings are calculated on what the vendor is actually
      // selling for: the pre-discount amount when the platform funds the promo,
      // the discounted amount when the vendor does.
      const commissionBasis = isPlatformCoupon
        ? subOrderSubtotal
        : toMoney(subOrderSubtotal - storeDiscount);

      const commissionAmount = toMoney((commissionBasis * commissionRate) / 100);
      const vendorEarning = toMoney(commissionBasis - commissionAmount);
      const subOrderTotal = toMoney(
        subOrderSubtotal + subOrderShipping - storeDiscount,
      );

      const subOrderResult = await client.query(
        `
                INSERT INTO sub_orders (
                    order_id,
                    store_id,
                    sub_order_number,
                    subtotal,
                    shipping_total,
                    discount_total,
                    commission_rate,
                    commission_amount,
                    vendor_earning,
                    grand_total,
                    status,
                    "createdAt",
                    "updatedAt"
                ) VALUES (
                    $1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10,
                    'PENDING'::"OrderStatus", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                )
                RETURNING *
            `,
        [
          createdOrder.id,
          storeId,
          `${orderNumber}-${storeIndex}`,
          subOrderSubtotal,
          subOrderShipping,
          storeDiscount,
          commissionRate,
          commissionAmount,
          vendorEarning,
          subOrderTotal,
        ],
      );

      const subOrder = subOrderResult.rows[0];

      for (const line of storeLines) {
        const lineTotal = toMoney(Number(line.unit_price) * line.quantity);

        await client.query(
          `
                    INSERT INTO order_items (
                        order_id,
                        sub_order_id,
                        store_id,
                        product_id,
                        variant_id,
                        type,
                        title,
                        variant_name,
                        thumbnail,
                        sku,
                        unit_price,
                        quantity,
                        line_total,
                        rental_start,
                        rental_end,
                        rental_units,
                        security_deposit,
                        booking_start,
                        "createdAt"
                    ) VALUES (
                        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
                        $6::"ProductType", $7, $8, $9, $10, $11, $12, $13,
                        $14, $15, $16, $17, $18, CURRENT_TIMESTAMP
                    )
                `,
          [
            createdOrder.id,
            subOrder.id,
            storeId,
            line.product_id,
            line.variant_id,
            line.type,
            line.title,
            line.variant_name,
            line.thumbnail,
            line.variant_sku || line.product_sku,
            line.unit_price,
            line.quantity,
            lineTotal,
            line.rental_start,
            line.rental_end,
            line.rental_units,
            line.type === "RENTAL" ? line.security_deposit || 0 : 0,
            line.booking_start,
          ],
        );

        // Reserve stock for physical goods right away
        if (line.type === "PHYSICAL") {
          const reserved = line.variant_id
            ? await client.query(
                `
                            UPDATE product_variants
                            SET stock = stock - $1, "updatedAt" = CURRENT_TIMESTAMP
                            WHERE id = $2::uuid AND stock >= $1
                            RETURNING stock
                        `,
                [line.quantity, line.variant_id],
              )
            : await client.query(
                `
                            UPDATE products
                            SET stock = stock - $1, "updatedAt" = CURRENT_TIMESTAMP
                            WHERE id = $2::uuid AND stock >= $1
                            RETURNING stock
                        `,
                [line.quantity, line.product_id],
              );

          // The guard means zero rows if someone else took the last unit
          // between validation and here, so the whole order rolls back.
          if (reserved.rows.length === 0) {
            throw new ApiError(
              httpStatus.CONFLICT,
              `"${line.title}" just went out of stock. Please review your cart.`,
            );
          }

          await InventoryService.recordMovement(client, {
            productId: line.product_id,
            variantId: line.variant_id,
            storeId,
            type: "SALE",
            quantityChange: -line.quantity,
            quantityAfter: reserved.rows[0].stock,
            referenceType: "order",
            referenceId: createdOrder.id,
            note: `Reserved for order ${orderNumber}`,
            createdBy: userId,
          });

          reservedProductIds.add(line.product_id);
        }
      }

      orderSubtotal += subOrderSubtotal;

      await client.query(
        `
                INSERT INTO order_status_history (order_id, sub_order_id, status, note, changed_by, "createdAt")
                VALUES ($1::uuid, $2::uuid, 'PENDING'::"OrderStatus", $3, $4::uuid, CURRENT_TIMESTAMP)
            `,
        [createdOrder.id, subOrder.id, "Order placed", userId],
      );
    }

    orderSubtotal = toMoney(orderSubtotal);
    const orderDiscount = appliedCoupon ? appliedCoupon.discount : 0;

    const finalOrder = await client.query(
      `
            UPDATE orders
            SET
                subtotal = $1,
                discount_total = $2,
                grand_total = $3,
                coupon_id = $4::uuid,
                coupon_code = $5,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $6::uuid
            RETURNING *
        `,
      [
        orderSubtotal,
        orderDiscount,
        toMoney(orderSubtotal - orderDiscount),
        appliedCoupon ? appliedCoupon.coupon.id : null,
        appliedCoupon ? appliedCoupon.coupon.code : null,
        createdOrder.id,
      ],
    );

    if (appliedCoupon) {
      await CouponService.recordCouponUsage(
        client,
        appliedCoupon.coupon.id,
        userId,
        createdOrder.id,
        orderDiscount,
      );
    }

    // The cart is consumed by the order
    await client.query(
      `
            DELETE FROM cart_items ci
            USING carts c
            WHERE ci.cart_id = c.id AND c.user_id = $1::uuid
        `,
      [userId],
    );

    const alerts = await InventoryService.collectLowStockAlerts(
      client,
      Array.from(reservedProductIds),
    );

    // Rentals and services become diary entries in the same transaction as the
    // order, so availability reflects the sale the instant it happens.
    await RentalService.createBookingsForOrder(client, createdOrder.id);
    await ServiceBookingService.createBookingsForOrder(client, createdOrder.id);

    return { order: finalOrder.rows[0], lowStockAlerts: alerts };
  });

  // Tell each vendor they have an order waiting, plus any low stock warnings
  const vendorNotifications = Array.from(storeGroups.entries()).map(
    ([, storeLines]) => ({
      user_id: storeLines[0].store_owner_id,
      type: "ORDER_PLACED",
      title: "New order received",
      body: `Order ${orderNumber} has ${storeLines.length} item(s) from your store. It ships once payment clears.`,
      data: { order_id: order.id, order_number: orderNumber },
    }),
  );

  await enqueueNotifications([...vendorNotifications, ...lowStockAlerts]);

  return orderDetailById(order.id);
};

// The reusable SELECT that hydrates an order with its vendor splits and lines
const orderDetailSelect = `
    o.*,
    (
        SELECT COALESCE(json_agg(
            json_build_object(
                'id', so.id,
                'sub_order_number', so.sub_order_number,
                'status', so.status,
                'subtotal', so.subtotal,
                'shipping_total', so.shipping_total,
                'discount_total', so.discount_total,
                'commission_rate', so.commission_rate,
                'commission_amount', so.commission_amount,
                'vendor_earning', so.vendor_earning,
                'grand_total', so.grand_total,
                'vendor_note', so.vendor_note,
                'cancellation_reason', so.cancellation_reason,
                'shipped_at', so.shipped_at,
                'delivered_at', so.delivered_at,
                'completed_at', so.completed_at,
                'cancelled_at', so.cancelled_at,
                'store', json_build_object(
                    'id', st.id,
                    'name', st.name,
                    'slug', st.slug,
                    'logo', st.logo
                ),
                'items', (
                    SELECT COALESCE(json_agg(
                        json_build_object(
                            'id', oi.id,
                            'product_id', oi.product_id,
                            'variant_id', oi.variant_id,
                            'type', oi.type,
                            'title', oi.title,
                            'variant_name', oi.variant_name,
                            'thumbnail', oi.thumbnail,
                            'sku', oi.sku,
                            'unit_price', oi.unit_price,
                            'quantity', oi.quantity,
                            'line_total', oi.line_total,
                            'rental_start', oi.rental_start,
                            'rental_end', oi.rental_end,
                            'rental_units', oi.rental_units,
                            'security_deposit', oi.security_deposit,
                            'booking_start', oi.booking_start,
                            'download_count', oi.download_count
                        ) ORDER BY oi."createdAt" ASC
                    ), '[]'::json)
                    FROM order_items oi WHERE oi.sub_order_id = so.id
                )
            ) ORDER BY so.sub_order_number ASC
        ), '[]'::json)
        FROM sub_orders so
        INNER JOIN stores st ON so.store_id = st.id
        WHERE so.order_id = o.id
    ) as sub_orders,
    (
        SELECT row_to_json(pay)
        FROM (
            SELECT id, provider, status, amount, currency, method, paid_at
            FROM payments
            WHERE order_id = o.id
            ORDER BY "createdAt" DESC
            LIMIT 1
        ) pay
    ) as payment
`;

// Single order detail, no ownership filter - used internally after checkout
const orderDetailById = async (orderId: string) => {
  const result = await query(
    `
        SELECT ${orderDetailSelect}
        FROM orders o
        WHERE o.id = $1::uuid
    `,
    [orderId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Order not found.");
  }

  return result.rows[0];
};

// My Orders - the buyer's own order history
const myOrders = async (userId: string, filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const status = filters.status || null;

  const ordersResult = await query(
    `
        SELECT
            o.id,
            o.order_number,
            o.status,
            o.payment_status,
            o.subtotal,
            o.grand_total,
            o.currency,
            o.placed_at,
            o."createdAt" as "createdAt",
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as total_items,
            (SELECT COUNT(*) FROM sub_orders so WHERE so.order_id = o.id) as total_stores,
            (
                SELECT COALESCE(json_agg(
                    json_build_object('title', oi.title, 'thumbnail', oi.thumbnail)
                ), '[]'::json)
                FROM (
                    SELECT title, thumbnail FROM order_items
                    WHERE order_id = o.id ORDER BY "createdAt" ASC LIMIT 3
                ) oi
            ) as preview_items
        FROM orders o
        WHERE o.user_id = $1::uuid
            AND ($2::text IS NULL OR o.status = $2::"OrderStatus")
        ORDER BY o."createdAt" DESC
        LIMIT $3 OFFSET $4
    `,
    [userId, status, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM orders o
        WHERE o.user_id = $1::uuid
            AND ($2::text IS NULL OR o.status = $2::"OrderStatus")
    `,
    [userId, status],
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
    data: ordersResult.rows,
  };
};

// Single order for the buyer who placed it
const myOrder = async (userId: string, orderId: string) => {
  const result = await query(
    `
        SELECT ${orderDetailSelect}
        FROM orders o
        WHERE o.id = $1::uuid AND o.user_id = $2::uuid
    `,
    [orderId, userId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Order not found.");
  }

  return result.rows[0];
};

// Give reserved stock back to the catalogue and log why it moved
const restoreStockForOrder = async (
  client: any,
  orderId: string,
  note: string,
  changedBy?: string | null,
) => {
  const items = await client.query(
    `
        SELECT product_id, variant_id, store_id, quantity
        FROM order_items
        WHERE order_id = $1::uuid AND type = 'PHYSICAL'::"ProductType"
    `,
    [orderId],
  );

  for (const item of items.rows) {
    const restored = item.variant_id
      ? await client.query(
          `
                UPDATE product_variants
                SET stock = stock + $1, "updatedAt" = CURRENT_TIMESTAMP
                WHERE id = $2::uuid
                RETURNING stock
            `,
          [item.quantity, item.variant_id],
        )
      : item.product_id
        ? await client.query(
            `
                UPDATE products
                SET stock = stock + $1, "updatedAt" = CURRENT_TIMESTAMP
                WHERE id = $2::uuid
                RETURNING stock
            `,
            [item.quantity, item.product_id],
          )
        : null;

    if (restored?.rows.length && item.product_id) {
      await InventoryService.recordMovement(client, {
        productId: item.product_id,
        variantId: item.variant_id,
        storeId: item.store_id,
        type: "ORDER_CANCELLED",
        quantityChange: item.quantity,
        quantityAfter: restored.rows[0].stock,
        referenceType: "order",
        referenceId: orderId,
        note,
        createdBy: changedBy || null,
      });
    }
  }
};

// Cancel Order - the buyer can back out until a vendor starts fulfilling
const cancelMyOrder = async (
  userId: string,
  orderId: string,
  payload: any,
) => {
  const orderResult = await query(
    `
        SELECT id, order_number, status, payment_status, grand_total FROM orders
        WHERE id = $1::uuid AND user_id = $2::uuid
    `,
    [orderId, userId],
  );

  if (orderResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Order not found.");
  }

  const order = orderResult.rows[0];

  if (!["PENDING", "CONFIRMED"].includes(order.status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `This order can no longer be cancelled because it is ${order.status}.`,
    );
  }

  // Any vendor that already moved forward blocks a buyer side cancellation
  const progressed = await query(
    `
        SELECT COUNT(*) as total FROM sub_orders
        WHERE order_id = $1::uuid
            AND status NOT IN ('PENDING'::"OrderStatus", 'CONFIRMED'::"OrderStatus", 'CANCELLED'::"OrderStatus")
    `,
    [orderId],
  );

  if (parseInt(progressed.rows[0].total) > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "A vendor has already started fulfilling part of this order. Please contact support.",
    );
  }

  const reason = payload.reason || "Cancelled by the customer";
  const wasPaid = order.payment_status === "PAID";

  const affectedStores = await query(
    `
        SELECT DISTINCT s.owner_id
        FROM sub_orders so
        INNER JOIN stores s ON so.store_id = s.id
        WHERE so.order_id = $1::uuid AND so.status != 'CANCELLED'::"OrderStatus"
    `,
    [orderId],
  );

  await transaction(async (client) => {
    await restoreStockForOrder(
      client,
      orderId,
      `Order ${order.order_number} cancelled`,
      userId,
    );

    await client.query(
      `
            UPDATE orders
            SET
                status = 'CANCELLED'::"OrderStatus",
                cancelled_at = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $1::uuid
        `,
      [orderId],
    );

    await client.query(
      `
            UPDATE sub_orders
            SET
                status = 'CANCELLED'::"OrderStatus",
                cancellation_reason = $1,
                cancelled_at = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE order_id = $2::uuid AND status != 'CANCELLED'::"OrderStatus"
        `,
      [reason, orderId],
    );

    // A coupon spent on a cancelled order is handed back to the buyer
    await CouponService.releaseCouponUsage(client, orderId);

    // Free the rental dates and the appointment slots again
    await RentalService.cancelBookingsForOrder(client, orderId, reason);
    await ServiceBookingService.cancelBookingsForOrder(client, orderId, reason);

    // Money that already arrived is returned as wallet credit, which the buyer
    // can spend again or withdraw. A card refund would need a Stripe call, so
    // the wallet keeps the ledger honest in the meantime.
    if (wasPaid) {
      await WalletService.refundOrderToWallet(
        client,
        orderId,
        Number(order.grand_total),
        userId,
        order.order_number,
      );

      await client.query(
        `
                UPDATE orders
                SET payment_status = 'REFUNDED'::"PaymentStatus", "updatedAt" = CURRENT_TIMESTAMP
                WHERE id = $1::uuid
            `,
        [orderId],
      );

      await client.query(
        `
                UPDATE payments
                SET
                    status = 'REFUNDED'::"PaymentStatus",
                    refunded_amount = amount,
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE order_id = $1::uuid AND status = 'PAID'::"PaymentStatus"
            `,
        [orderId],
      );
    }

    await client.query(
      `
            INSERT INTO order_status_history (order_id, status, note, changed_by, "createdAt")
            VALUES ($1::uuid, 'CANCELLED'::"OrderStatus", $2, $3::uuid, CURRENT_TIMESTAMP)
        `,
      [orderId, reason, userId],
    );
  });

  await enqueueNotifications([
    ...affectedStores.rows.map((row: any) => ({
      user_id: row.owner_id,
      type: "ORDER_CANCELLED",
      title: "Order cancelled",
      body: `The buyer cancelled order ${order.order_number}.`,
      data: { order_id: orderId, order_number: order.order_number },
    })),
    ...(wasPaid
      ? [
          {
            user_id: userId,
            type: "WALLET_CREDIT",
            title: "Refund added to your wallet",
            body: `${Number(order.grand_total).toFixed(2)} from order ${order.order_number} is now in your wallet.`,
            data: { order_id: orderId, amount: order.grand_total },
          },
        ]
      : []),
  ]);

  return myOrder(userId, orderId);
};

// Vendor Orders - the sub orders that belong to the vendor's own store
const vendorOrders = async (userId: string, filters: any) => {
  const store = await getVendorStore(userId);

  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const status = filters.status || null;
  const searchTerm = filters.searchTerm || null;

  const subOrdersResult = await query(
    `
        SELECT
            so.id,
            so.sub_order_number,
            so.status,
            so.subtotal,
            so.discount_total,
            so.commission_amount,
            so.vendor_earning,
            so.grand_total,
            so."createdAt" as "createdAt",
            json_build_object(
                'id', o.id,
                'order_number', o.order_number,
                'payment_status', o.payment_status,
                'placed_at', o.placed_at,
                'shipping_address', o.shipping_address
            ) as order,
            json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email,
                'avatar', u.avatar,
                'phone_number', u.phone_number
            ) as customer,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.sub_order_id = so.id) as total_items
        FROM sub_orders so
        INNER JOIN orders o ON so.order_id = o.id
        INNER JOIN users u ON o.user_id = u.id
        WHERE so.store_id = $1::uuid
            AND ($2::text IS NULL OR so.status = $2::"OrderStatus")
            AND ($3::text IS NULL OR so.sub_order_number ILIKE '%' || $3 || '%' OR u.name ILIKE '%' || $3 || '%')
        ORDER BY so."createdAt" DESC
        LIMIT $4 OFFSET $5
    `,
    [store.id, status, searchTerm, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM sub_orders so
        INNER JOIN orders o ON so.order_id = o.id
        INNER JOIN users u ON o.user_id = u.id
        WHERE so.store_id = $1::uuid
            AND ($2::text IS NULL OR so.status = $2::"OrderStatus")
            AND ($3::text IS NULL OR so.sub_order_number ILIKE '%' || $3 || '%' OR u.name ILIKE '%' || $3 || '%')
    `,
    [store.id, status, searchTerm],
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
    data: subOrdersResult.rows,
  };
};

// Single sub order detail for the vendor who owns it
const vendorOrder = async (userId: string, subOrderId: string) => {
  const store = await getVendorStore(userId);

  const result = await query(
    `
        SELECT
            so.*,
            json_build_object(
                'id', o.id,
                'order_number', o.order_number,
                'status', o.status,
                'payment_status', o.payment_status,
                'currency', o.currency,
                'shipping_address', o.shipping_address,
                'customer_note', o.customer_note,
                'placed_at', o.placed_at
            ) as order,
            json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email,
                'avatar', u.avatar,
                'phone_number', u.phone_number
            ) as customer,
            (
                SELECT COALESCE(json_agg(
                    json_build_object(
                        'id', oi.id,
                        'product_id', oi.product_id,
                        'type', oi.type,
                        'title', oi.title,
                        'variant_name', oi.variant_name,
                        'thumbnail', oi.thumbnail,
                        'sku', oi.sku,
                        'unit_price', oi.unit_price,
                        'quantity', oi.quantity,
                        'line_total', oi.line_total,
                        'rental_start', oi.rental_start,
                        'rental_end', oi.rental_end,
                        'rental_units', oi.rental_units,
                        'booking_start', oi.booking_start
                    ) ORDER BY oi."createdAt" ASC
                ), '[]'::json)
                FROM order_items oi WHERE oi.sub_order_id = so.id
            ) as items
        FROM sub_orders so
        INNER JOIN orders o ON so.order_id = o.id
        INNER JOIN users u ON o.user_id = u.id
        WHERE so.id = $1::uuid AND so.store_id = $2::uuid
    `,
    [subOrderId, store.id],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Order not found in your store.");
  }

  return result.rows[0];
};

// Roll the buyer facing order status up from its vendor sub orders
const syncOrderStatusFromSubOrders = async (client: any, orderId: string) => {
  const statusesResult = await client.query(
    `
        SELECT status, COUNT(*) as total
        FROM sub_orders
        WHERE order_id = $1::uuid
        GROUP BY status
    `,
    [orderId],
  );

  const counts: Record<string, number> = {};
  let totalSubOrders = 0;

  statusesResult.rows.forEach((row: any) => {
    counts[row.status] = parseInt(row.total);
    totalSubOrders += parseInt(row.total);
  });

  const isAll = (status: string) => counts[status] === totalSubOrders;

  let rolledUpStatus: string | null = null;

  if (isAll("CANCELLED")) {
    rolledUpStatus = "CANCELLED";
  } else if (isAll("COMPLETED")) {
    rolledUpStatus = "COMPLETED";
  } else if (
    (counts.DELIVERED || 0) + (counts.COMPLETED || 0) + (counts.CANCELLED || 0) ===
    totalSubOrders
  ) {
    rolledUpStatus = "DELIVERED";
  } else if (counts.SHIPPED) {
    rolledUpStatus = "SHIPPED";
  } else if (counts.PROCESSING) {
    rolledUpStatus = "PROCESSING";
  }

  if (rolledUpStatus) {
    await client.query(
      `
            UPDATE orders
            SET
                status = $1::"OrderStatus",
                cancelled_at = CASE WHEN $1 = 'CANCELLED' THEN CURRENT_TIMESTAMP ELSE cancelled_at END,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $2::uuid
        `,
      [rolledUpStatus, orderId],
    );
  }
};

// Update Sub Order Status - the vendor drives fulfilment
const updateSubOrderStatus = async (
  userId: string,
  subOrderId: string,
  payload: any,
) => {
  const store = await getVendorStore(userId);

  const subOrderResult = await query(
    `
        SELECT
            so.id,
            so.order_id,
            so.status,
            so.sub_order_number,
            so.vendor_earning,
            o.payment_status,
            o.order_number,
            o.user_id as buyer_id
        FROM sub_orders so
        INNER JOIN orders o ON so.order_id = o.id
        WHERE so.id = $1::uuid AND so.store_id = $2::uuid
    `,
    [subOrderId, store.id],
  );

  if (subOrderResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Order not found in your store.");
  }

  const subOrder = subOrderResult.rows[0];
  const nextStatus = payload.status;

  const allowed = allowedStatusTransitions[subOrder.status] || [];

  if (!allowed.includes(nextStatus)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `A ${subOrder.status} order cannot be moved to ${nextStatus}.`,
    );
  }

  // Nothing ships before the money arrives
  if (
    ["PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"].includes(nextStatus) &&
    subOrder.payment_status !== "PAID"
  ) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This order has not been paid yet.",
    );
  }

  if (nextStatus === "CANCELLED" && !payload.cancellation_reason) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "A cancellation reason is required.",
    );
  }

  const creditedEarning = await transaction(async (client) => {
    // Returned out of the transaction so the notification is only sent once the
    // credit has actually committed
    let credited: { ownerId: string; earning: number } | null = null;

    await client.query(
      `
            UPDATE sub_orders
            SET
                status = $1::"OrderStatus",
                vendor_note = COALESCE($2, vendor_note),
                cancellation_reason = CASE WHEN $1 = 'CANCELLED' THEN $3 ELSE cancellation_reason END,
                shipped_at = CASE WHEN $1 = 'SHIPPED' THEN CURRENT_TIMESTAMP ELSE shipped_at END,
                delivered_at = CASE WHEN $1 = 'DELIVERED' THEN CURRENT_TIMESTAMP ELSE delivered_at END,
                completed_at = CASE WHEN $1 = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE completed_at END,
                cancelled_at = CASE WHEN $1 = 'CANCELLED' THEN CURRENT_TIMESTAMP ELSE cancelled_at END,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $4::uuid
        `,
      [
        nextStatus,
        payload.vendor_note || null,
        payload.cancellation_reason || null,
        subOrderId,
      ],
    );

    // A vendor cancelling their part releases only their own stock
    if (nextStatus === "CANCELLED") {
      const items = await client.query(
        `
                SELECT product_id, variant_id, store_id, quantity
                FROM order_items
                WHERE sub_order_id = $1::uuid AND type = 'PHYSICAL'::"ProductType"
            `,
        [subOrderId],
      );

      for (const item of items.rows) {
        const restored = item.variant_id
          ? await client.query(
              `
                        UPDATE product_variants
                        SET stock = stock + $1, "updatedAt" = CURRENT_TIMESTAMP
                        WHERE id = $2::uuid
                        RETURNING stock
                    `,
              [item.quantity, item.variant_id],
            )
          : item.product_id
            ? await client.query(
                `
                        UPDATE products
                        SET stock = stock + $1, "updatedAt" = CURRENT_TIMESTAMP
                        WHERE id = $2::uuid
                        RETURNING stock
                    `,
                [item.quantity, item.product_id],
              )
            : null;

        if (restored?.rows.length && item.product_id) {
          await InventoryService.recordMovement(client, {
            productId: item.product_id,
            variantId: item.variant_id,
            storeId: item.store_id,
            type: "ORDER_CANCELLED",
            quantityChange: item.quantity,
            quantityAfter: restored.rows[0].stock,
            referenceType: "sub_order",
            referenceId: subOrderId,
            note: payload.cancellation_reason || "Cancelled by the vendor",
            createdBy: userId,
          });
        }
      }
    }

    // Fulfilment is done, so the money the marketplace was holding is released
    // to the vendor. creditVendorEarning is idempotent, so a repeated
    // transition can never pay twice.
    if (nextStatus === "COMPLETED") {
      const result = await WalletService.creditVendorEarning(client, subOrderId);

      if (result) {
        credited = { ownerId: result.ownerId, earning: result.earning };
      }
    }

    await client.query(
      `
            INSERT INTO order_status_history (order_id, sub_order_id, status, note, changed_by, "createdAt")
            VALUES ($1::uuid, $2::uuid, $3::"OrderStatus", $4, $5::uuid, CURRENT_TIMESTAMP)
        `,
      [
        subOrder.order_id,
        subOrderId,
        nextStatus,
        payload.vendor_note || payload.cancellation_reason || null,
        userId,
      ],
    );

    await syncOrderStatusFromSubOrders(client, subOrder.order_id);

    return credited;
  });

  const notifications: any[] = [
    {
      user_id: subOrder.buyer_id,
      type: nextStatus === "CANCELLED" ? "ORDER_CANCELLED" : "ORDER_STATUS",
      title: `Order ${nextStatus.toLowerCase()}`,
      body:
        nextStatus === "CANCELLED"
          ? `${store.name} cancelled part of order ${subOrder.order_number}: ${payload.cancellation_reason}`
          : `Your items from ${store.name} in order ${subOrder.order_number} are now ${nextStatus.toLowerCase()}.`,
      data: {
        order_id: subOrder.order_id,
        sub_order_id: subOrderId,
        status: nextStatus,
      },
    },
  ];

  if (creditedEarning) {
    notifications.push({
      user_id: creditedEarning.ownerId,
      type: "WALLET_CREDIT",
      title: "Earning added to your wallet",
      body: `${Number(creditedEarning.earning).toFixed(2)} from order ${subOrder.order_number} is now available to withdraw.`,
      data: {
        sub_order_id: subOrderId,
        amount: creditedEarning.earning,
      },
    });
  }

  await enqueueNotifications(notifications);

  return vendorOrder(userId, subOrderId);
};

// All Orders for admin
const allOrdersForAdmin = async (filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const status = filters.status || null;
  const paymentStatus = filters.payment_status || null;
  const searchTerm = filters.searchTerm || null;

  const ordersResult = await query(
    `
        SELECT
            o.id,
            o.order_number,
            o.status,
            o.payment_status,
            o.subtotal,
            o.grand_total,
            o.currency,
            o.placed_at,
            o."createdAt" as "createdAt",
            json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email,
                'avatar', u.avatar
            ) as customer,
            (SELECT COUNT(*) FROM sub_orders so WHERE so.order_id = o.id) as total_stores,
            (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as total_items,
            (
                SELECT COALESCE(SUM(so.commission_amount), 0)
                FROM sub_orders so WHERE so.order_id = o.id
            ) as platform_commission
        FROM orders o
        INNER JOIN users u ON o.user_id = u.id
        WHERE ($1::text IS NULL OR o.status = $1::"OrderStatus")
            AND ($2::text IS NULL OR o.payment_status = $2::"PaymentStatus")
            AND ($3::text IS NULL OR o.order_number ILIKE '%' || $3 || '%' OR u.email ILIKE '%' || $3 || '%')
        ORDER BY o."createdAt" DESC
        LIMIT $4 OFFSET $5
    `,
    [status, paymentStatus, searchTerm, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM orders o
        INNER JOIN users u ON o.user_id = u.id
        WHERE ($1::text IS NULL OR o.status = $1::"OrderStatus")
            AND ($2::text IS NULL OR o.payment_status = $2::"PaymentStatus")
            AND ($3::text IS NULL OR o.order_number ILIKE '%' || $3 || '%' OR u.email ILIKE '%' || $3 || '%')
    `,
    [status, paymentStatus, searchTerm],
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
    data: ordersResult.rows,
  };
};

// Single order detail for admin
const orderForAdmin = async (orderId: string) => {
  return orderDetailById(orderId);
};

export const OrderService = {
  checkout,
  myOrders,
  myOrder,
  cancelMyOrder,
  vendorOrders,
  vendorOrder,
  updateSubOrderStatus,
  allOrdersForAdmin,
  orderForAdmin,
};
