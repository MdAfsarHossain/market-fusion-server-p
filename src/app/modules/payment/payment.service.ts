import httpStatus from "http-status";
import Stripe from "stripe";
import ApiError from "../../errors/ApiError";
import config from "../../../config";
import { query, transaction } from "../../utils/db";
import { getStripeClient } from "../../lib/stripeClient";
import { enqueueNotifications } from "../../queues/notification.queue";

// Stripe works in the smallest currency unit
const toStripeAmount = (amount: number) => Math.round(Number(amount) * 100);

// Load an order that is still waiting to be paid
const getPayableOrder = async (userId: string, orderId: string) => {
  const result = await query(
    `
        SELECT
            o.id,
            o.order_number,
            o.grand_total,
            o.currency,
            o.status,
            o.payment_status
        FROM orders o
        WHERE o.id = $1::uuid AND o.user_id = $2::uuid
    `,
    [orderId, userId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Order not found.");
  }

  const order = result.rows[0];

  if (order.payment_status === "PAID") {
    throw new ApiError(
      httpStatus.CONFLICT,
      "This order has already been paid for.",
    );
  }

  if (["CANCELLED", "REFUNDED"].includes(order.status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `This order is ${order.status.toLowerCase()} and can no longer be paid for.`,
    );
  }

  return order;
};

// Create Checkout Session - hand the buyer a Stripe hosted payment page
const createCheckoutSession = async (userId: string, orderId: string) => {
  const order = await getPayableOrder(userId, orderId);

  // Build one Stripe line item per order line so the buyer sees what they buy
  const itemsResult = await query(
    `
        SELECT
            oi.title,
            oi.variant_name,
            oi.thumbnail,
            oi.unit_price,
            oi.quantity,
            oi.security_deposit,
            s.name as store_name
        FROM order_items oi
        INNER JOIN stores s ON oi.store_id = s.id
        WHERE oi.order_id = $1::uuid
        ORDER BY oi."createdAt" ASC
    `,
    [orderId],
  );

  const currency = String(order.currency || "USD").toLowerCase();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] =
    itemsResult.rows.map((item: any) => {
      const unitAmount = toStripeAmount(
        Number(item.unit_price) + Number(item.security_deposit || 0),
      );

      return {
        quantity: item.quantity,
        price_data: {
          currency,
          unit_amount: unitAmount,
          product_data: {
            name: item.variant_name
              ? `${item.title} - ${item.variant_name}`
              : item.title,
            description: `Sold by ${item.store_name}`,
            ...(item.thumbnail ? { images: [item.thumbnail] } : {}),
          },
        },
      };
    });

  const successUrl =
    config.frontend.success_url || "http://localhost:3000/payment/success";
  const cancelUrl =
    config.frontend.cancel_url || "http://localhost:3000/payment/cancel";

  let session: Stripe.Checkout.Session;

  try {
    session = await getStripeClient().checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      client_reference_id: order.id,
      metadata: {
        order_id: order.id,
        order_number: order.order_number,
        user_id: userId,
      },
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&order_number=${order.order_number}`,
      cancel_url: `${cancelUrl}?order_number=${order.order_number}`,
    });
  } catch (error: any) {
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      error?.message || "Could not start the payment. Please try again.",
    );
  }

  // One pending payment row per attempt, so every try is auditable
  const paymentResult = await query(
    `
        INSERT INTO payments (
            order_id,
            user_id,
            provider,
            provider_session_id,
            amount,
            currency,
            status,
            "createdAt",
            "updatedAt"
        ) VALUES (
            $1::uuid, $2::uuid, 'STRIPE'::"PaymentProvider", $3, $4, $5,
            'PENDING'::"PaymentStatus", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        RETURNING id, provider_session_id, amount, currency, status
    `,
    [order.id, userId, session.id, order.grand_total, order.currency],
  );

  return {
    payment: paymentResult.rows[0],
    order_number: order.order_number,
    session_id: session.id,
    checkout_url: session.url,
  };
};

// Mark an order and its vendor splits as paid. Safe to call more than once.
const markOrderAsPaid = async (
  orderId: string,
  paymentUpdate: {
    provider_payment_id?: string | null;
    method?: string | null;
    raw?: any;
    session_id?: string | null;
  },
) => {
  // Only set when this call is the one that actually settled the order, so a
  // replayed webhook does not re-notify anyone.
  let settled: { orderNumber: string; buyerId: string } | null = null;

  await transaction(async (client) => {
    const orderResult = await client.query(
      `
            SELECT id, order_number, user_id, payment_status
            FROM orders WHERE id = $1::uuid FOR UPDATE
        `,
      [orderId],
    );

    if (orderResult.rows.length === 0) {
      return;
    }

    // Idempotency guard - a replayed webhook must not double apply anything
    if (orderResult.rows[0].payment_status === "PAID") {
      return;
    }

    settled = {
      orderNumber: orderResult.rows[0].order_number,
      buyerId: orderResult.rows[0].user_id,
    };

    await client.query(
      `
            UPDATE payments
            SET
                status = 'PAID'::"PaymentStatus",
                provider_payment_id = COALESCE($1, provider_payment_id),
                method = COALESCE($2, method),
                raw_response = COALESCE($3::jsonb, raw_response),
                paid_at = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE order_id = $4::uuid
                AND ($5::text IS NULL OR provider_session_id = $5)
        `,
      [
        paymentUpdate.provider_payment_id || null,
        paymentUpdate.method || null,
        paymentUpdate.raw ? JSON.stringify(paymentUpdate.raw) : null,
        orderId,
        paymentUpdate.session_id || null,
      ],
    );

    await client.query(
      `
            UPDATE orders
            SET
                payment_status = 'PAID'::"PaymentStatus",
                status = 'CONFIRMED'::"OrderStatus",
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $1::uuid
        `,
      [orderId],
    );

    await client.query(
      `
            UPDATE sub_orders
            SET
                status = 'CONFIRMED'::"OrderStatus",
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE order_id = $1::uuid AND status = 'PENDING'::"OrderStatus"
        `,
      [orderId],
    );

    // Sales counters only move once the money has actually arrived
    await client.query(
      `
            UPDATE products p
            SET
                total_sold = p.total_sold + agg.quantity,
                "updatedAt" = CURRENT_TIMESTAMP
            FROM (
                SELECT product_id, SUM(quantity) as quantity
                FROM order_items
                WHERE order_id = $1::uuid AND product_id IS NOT NULL
                GROUP BY product_id
            ) agg
            WHERE p.id = agg.product_id
        `,
      [orderId],
    );

    await client.query(
      `
            UPDATE stores s
            SET
                total_sales = s.total_sales + agg.earning,
                "updatedAt" = CURRENT_TIMESTAMP
            FROM (
                SELECT store_id, SUM(vendor_earning) as earning
                FROM sub_orders
                WHERE order_id = $1::uuid
                GROUP BY store_id
            ) agg
            WHERE s.id = agg.store_id
        `,
      [orderId],
    );

    await client.query(
      `
            INSERT INTO order_status_history (order_id, status, note, "createdAt")
            VALUES ($1::uuid, 'CONFIRMED'::"OrderStatus", 'Payment received', CURRENT_TIMESTAMP)
        `,
      [orderId],
    );
  });

  if (!settled) {
    return;
  }

  const { orderNumber, buyerId } = settled as {
    orderNumber: string;
    buyerId: string;
  };

  // Every vendor in the split needs to know they can start fulfilling
  const vendors = await query(
    `
        SELECT DISTINCT s.owner_id
        FROM sub_orders so
        INNER JOIN stores s ON so.store_id = s.id
        WHERE so.order_id = $1::uuid
    `,
    [orderId],
  );

  await enqueueNotifications([
    {
      user_id: buyerId,
      type: "ORDER_PAID",
      title: "Payment confirmed",
      body: `Your payment for order ${orderNumber} was received. The vendors are preparing it now.`,
      data: { order_id: orderId, order_number: orderNumber },
    },
    ...vendors.rows.map((row: any) => ({
      user_id: row.owner_id,
      type: "ORDER_PAID",
      title: "Order paid",
      body: `Order ${orderNumber} has been paid. You can start fulfilling it.`,
      data: { order_id: orderId, order_number: orderNumber },
    })),
  ]);
};

// Mark a payment attempt as failed without touching the order's reservation
const markPaymentFailed = async (
  sessionId: string,
  status: "FAILED" | "EXPIRED" | "CANCELLED",
  reason?: string,
) => {
  await query(
    `
        UPDATE payments
        SET
            status = $1::"PaymentStatus",
            failure_reason = $2,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE provider_session_id = $3
            AND status IN ('PENDING'::"PaymentStatus", 'PROCESSING'::"PaymentStatus")
    `,
    [status, reason || null, sessionId],
  );
};

// Verify Session - the success page calls this so the buyer is never left waiting
// for the webhook to land.
const verifySession = async (userId: string, sessionId: string) => {
  const paymentResult = await query(
    `
        SELECT p.id, p.order_id, p.status, o.order_number
        FROM payments p
        INNER JOIN orders o ON p.order_id = o.id
        WHERE p.provider_session_id = $1 AND p.user_id = $2::uuid
    `,
    [sessionId, userId],
  );

  if (paymentResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Payment not found.");
  }

  const payment = paymentResult.rows[0];

  let session: Stripe.Checkout.Session;

  try {
    session = await getStripeClient().checkout.sessions.retrieve(sessionId);
  } catch (error: any) {
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      error?.message || "Could not verify the payment right now.",
    );
  }

  if (session.payment_status === "paid") {
    await markOrderAsPaid(payment.order_id, {
      provider_payment_id:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null,
      method: session.payment_method_types?.[0] || null,
      raw: session,
      session_id: sessionId,
    });
  }

  const refreshed = await query(
    `
        SELECT
            p.id,
            p.status,
            p.amount,
            p.currency,
            p.method,
            p.paid_at,
            o.id as order_id,
            o.order_number,
            o.status as order_status,
            o.payment_status
        FROM payments p
        INNER JOIN orders o ON p.order_id = o.id
        WHERE p.id = $1::uuid
    `,
    [payment.id],
  );

  return refreshed.rows[0];
};

// Handle Stripe Webhook - verifies the signature and applies the event once
const handleStripeWebhook = async (rawBody: Buffer, signature?: string) => {
  if (!signature) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Missing the stripe-signature header.",
    );
  }

  let event: Stripe.Event;

  try {
    event = getStripeClient().webhooks.constructEvent(
      rawBody,
      signature,
      config.stripe.webhook_secret as string,
    );
  } catch (error: any) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Webhook signature verification failed: ${error?.message}`,
    );
  }

  // Record the event first. The unique constraint on event_id makes a replayed
  // delivery a no-op instead of a second state change.
  const eventInsert = await query(
    `
        INSERT INTO payment_events (provider, event_id, event_type, payload, "createdAt")
        VALUES ('STRIPE'::"PaymentProvider", $1, $2, $3::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING id
    `,
    [event.id, event.type, JSON.stringify(event)],
  );

  if (eventInsert.rows.length === 0) {
    return { received: true, duplicate: true, type: event.type };
  }

  const eventRowId = eventInsert.rows[0].id;

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id || session.client_reference_id;

        if (orderId && session.payment_status === "paid") {
          await markOrderAsPaid(orderId, {
            provider_payment_id:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id || null,
            method: session.payment_method_types?.[0] || null,
            raw: session,
            session_id: session.id,
          });
        }
        break;
      }

      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orderId = session.metadata?.order_id || session.client_reference_id;

        if (orderId) {
          await markOrderAsPaid(orderId, {
            provider_payment_id:
              typeof session.payment_intent === "string"
                ? session.payment_intent
                : session.payment_intent?.id || null,
            method: session.payment_method_types?.[0] || null,
            raw: session,
            session_id: session.id,
          });
        }
        break;
      }

      case "checkout.session.async_payment_failed": {
        const session = event.data.object as Stripe.Checkout.Session;
        await markPaymentFailed(session.id, "FAILED", "Async payment failed");
        break;
      }

      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        await markPaymentFailed(
          session.id,
          "EXPIRED",
          "The checkout session expired",
        );
        break;
      }

      default:
        // Everything else is stored for the audit trail but needs no action
        break;
    }

    await query(
      `
            UPDATE payment_events
            SET processed = true, processed_at = CURRENT_TIMESTAMP
            WHERE id = $1::uuid
        `,
      [eventRowId],
    );

    return { received: true, duplicate: false, type: event.type };
  } catch (error: any) {
    await query(
      `
            UPDATE payment_events
            SET error = $1, processed_at = CURRENT_TIMESTAMP
            WHERE id = $2::uuid
        `,
      [error?.message || "Unknown error", eventRowId],
    );

    throw error;
  }
};

// My Payments - the buyer's payment history
const myPayments = async (userId: string, filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const status = filters.status || null;

  const paymentsResult = await query(
    `
        SELECT
            p.id,
            p.provider,
            p.provider_payment_id,
            p.amount,
            p.currency,
            p.status,
            p.method,
            p.refunded_amount,
            p.paid_at,
            p."createdAt" as "createdAt",
            json_build_object(
                'id', o.id,
                'order_number', o.order_number,
                'status', o.status,
                'grand_total', o.grand_total
            ) as order
        FROM payments p
        INNER JOIN orders o ON p.order_id = o.id
        WHERE p.user_id = $1::uuid
            AND ($2::text IS NULL OR p.status = $2::"PaymentStatus")
        ORDER BY p."createdAt" DESC
        LIMIT $3 OFFSET $4
    `,
    [userId, status, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM payments p
        WHERE p.user_id = $1::uuid
            AND ($2::text IS NULL OR p.status = $2::"PaymentStatus")
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
    data: paymentsResult.rows,
  };
};

// All Payments for admin
const allPaymentsForAdmin = async (filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const status = filters.status || null;
  const searchTerm = filters.searchTerm || null;

  const paymentsResult = await query(
    `
        SELECT
            p.*,
            json_build_object(
                'id', o.id,
                'order_number', o.order_number,
                'status', o.status
            ) as order,
            json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email
            ) as customer
        FROM payments p
        INNER JOIN orders o ON p.order_id = o.id
        INNER JOIN users u ON p.user_id = u.id
        WHERE ($1::text IS NULL OR p.status = $1::"PaymentStatus")
            AND ($2::text IS NULL OR o.order_number ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%')
        ORDER BY p."createdAt" DESC
        LIMIT $3 OFFSET $4
    `,
    [status, searchTerm, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM payments p
        INNER JOIN orders o ON p.order_id = o.id
        INNER JOIN users u ON p.user_id = u.id
        WHERE ($1::text IS NULL OR p.status = $1::"PaymentStatus")
            AND ($2::text IS NULL OR o.order_number ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%')
    `,
    [status, searchTerm],
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
    data: paymentsResult.rows,
  };
};

export const PaymentService = {
  createCheckoutSession,
  verifySession,
  handleStripeWebhook,
  myPayments,
  allPaymentsForAdmin,
  // Exposed so other providers (Mollie, wallet) can settle an order the same way
  markOrderAsPaid,
};
