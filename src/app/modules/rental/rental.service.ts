import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { query, transaction } from "../../utils/db";
import { resolveStoreFor } from "../../utils/storeAccess";
import { WalletService } from "../wallet/wallet.service";
import { enqueueNotifications } from "../../queues/notification.queue";

const toMoney = (value: number) => Number(value.toFixed(2));

// Statuses that still hold a unit off the shelf
const BLOCKING_STATUSES = `('RESERVED'::"RentalBookingStatus", 'ACTIVE'::"RentalBookingStatus", 'OVERDUE'::"RentalBookingStatus")`;

const getVendorStore = async (userId: string) => {
  const access = await resolveStoreFor(userId, "BOOKINGS");
  return access.store;
};

// How many units of a rental are free in a given window.
//
// Availability is an overlap question, not a running count: two bookings for
// the same week compete, two bookings a month apart do not. Only confirmed
// bookings reserve stock — a cart is not a reservation.
const checkAvailability = async (
  productId: string,
  start: Date,
  end: Date,
  client?: any,
) => {
  const run = client
    ? (text: string, params: any[]) => client.query(text, params)
    : query;

  const productResult = await run(
    `
        SELECT
            p.id,
            p.title,
            rp.available_quantity,
            rp.rental_unit,
            rp.min_units,
            rp.max_units,
            rp.price_per_unit,
            rp.security_deposit
        FROM products p
        INNER JOIN rental_products rp ON rp.product_id = p.id
        WHERE p.id = $1::uuid
    `,
    [productId],
  );

  if (productResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Rental product not found.");
  }

  const product = productResult.rows[0];

  const bookedResult = await run(
    `
        SELECT COALESCE(SUM(quantity), 0) as booked
        FROM rental_bookings
        WHERE product_id = $1::uuid
            AND status IN ${BLOCKING_STATUSES}
            AND rental_start < $3::timestamp
            AND rental_end > $2::timestamp
    `,
    [productId, start, end],
  );

  const booked = parseInt(bookedResult.rows[0].booked);
  const total = product.available_quantity;

  return {
    product_id: product.id,
    title: product.title,
    rental_unit: product.rental_unit,
    min_units: product.min_units,
    max_units: product.max_units,
    price_per_unit: product.price_per_unit,
    security_deposit: product.security_deposit,
    total_quantity: total,
    booked,
    available: Math.max(0, total - booked),
  };
};

// Public availability lookup for a date range
const availability = async (productId: string, filters: any) => {
  if (!filters.start || !filters.end) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Please provide both a start and an end date.",
    );
  }

  const start = new Date(filters.start);
  const end = new Date(filters.end);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Those dates are not valid.");
  }

  if (end <= start) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "The end date must be after the start date.",
    );
  }

  const result = await checkAvailability(productId, start, end);

  return { ...result, start, end, is_available: result.available > 0 };
};

// Which windows are already taken, so a calendar can grey them out
const bookedWindows = async (productId: string, filters: any) => {
  const from = filters.from ? new Date(filters.from) : new Date();
  const days = parseInt(filters.days) || 90;
  const to = new Date(from.getTime() + days * 86_400_000);

  const productResult = await query(
    `SELECT available_quantity FROM rental_products WHERE product_id = $1::uuid`,
    [productId],
  );

  if (productResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Rental product not found.");
  }

  const result = await query(
    `
        SELECT
            rental_start,
            rental_end,
            SUM(quantity) as quantity
        FROM rental_bookings
        WHERE product_id = $1::uuid
            AND status IN ${BLOCKING_STATUSES}
            AND rental_end > $2::timestamp
            AND rental_start < $3::timestamp
        GROUP BY rental_start, rental_end
        ORDER BY rental_start ASC
    `,
    [productId, from, to],
  );

  return {
    total_quantity: productResult.rows[0].available_quantity,
    from,
    to,
    windows: result.rows,
  };
};

// Turn the rental lines of a paid order into bookings.
//
// Called from checkout inside its transaction, so a booking exists the moment
// the order does and availability immediately reflects it.
const createBookingsForOrder = async (client: any, orderId: string) => {
  const items = await client.query(
    `
        SELECT
            oi.id,
            oi.order_id,
            oi.sub_order_id,
            oi.product_id,
            oi.store_id,
            oi.quantity,
            oi.rental_start,
            oi.rental_end,
            oi.rental_units,
            oi.security_deposit,
            o.user_id
        FROM order_items oi
        INNER JOIN orders o ON oi.order_id = o.id
        WHERE oi.order_id = $1::uuid
            AND oi.type = 'RENTAL'::"ProductType"
            AND oi.rental_start IS NOT NULL
    `,
    [orderId],
  );

  for (const item of items.rows) {
    // order_items.security_deposit is the per-unit figure, but checkout charges
    // it once per unit. The booking must hold the whole amount taken, otherwise
    // the refund on return would short the buyer.
    const deposit =
      (Number(item.security_deposit) || 0) * (Number(item.quantity) || 1);

    await client.query(
      `
            INSERT INTO rental_bookings (
                order_item_id, order_id, sub_order_id, product_id, store_id, user_id,
                rental_start, rental_end, rental_units, quantity,
                security_deposit, deposit_status, status,
                "createdAt", "updatedAt"
            ) VALUES (
                $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
                $7, $8, $9, $10, $11, $12::"DepositStatus",
                'RESERVED'::"RentalBookingStatus", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            ON CONFLICT (order_item_id) DO NOTHING
        `,
      [
        item.id,
        item.order_id,
        item.sub_order_id,
        item.product_id,
        item.store_id,
        item.user_id,
        item.rental_start,
        item.rental_end,
        item.rental_units,
        item.quantity,
        deposit,
        deposit > 0 ? "HELD" : "NONE",
      ],
    );
  }

  return items.rows.length;
};

// Cancel the bookings behind a cancelled order, freeing the dates again
const cancelBookingsForOrder = async (
  client: any,
  orderId: string,
  reason: string,
) => {
  await client.query(
    `
        UPDATE rental_bookings
        SET
            status = 'CANCELLED'::"RentalBookingStatus",
            vendor_note = COALESCE(vendor_note, $2),
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE order_id = $1::uuid
            AND status IN ${BLOCKING_STATUSES}
    `,
    [orderId, reason],
  );
};

const bookingDetailSelect = `
    rb.*,
    json_build_object(
        'id', o.id,
        'order_number', o.order_number,
        'payment_status', o.payment_status
    ) as order,
    CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
        'id', p.id,
        'title', p.title,
        'slug', p.slug,
        'thumbnail', p.thumbnail
    ) END as product,
    json_build_object(
        'id', s.id,
        'name', s.name,
        'slug', s.slug
    ) as store,
    json_build_object(
        'id', u.id,
        'name', u.name,
        'email', u.email,
        'phone_number', u.phone_number
    ) as customer,
    oi.title as item_title,
    oi.unit_price
`;

// The buyer's own rentals
const myBookings = async (userId: string, filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const status = filters.status || null;

  const result = await query(
    `
        SELECT ${bookingDetailSelect}
        FROM rental_bookings rb
        INNER JOIN orders o ON rb.order_id = o.id
        INNER JOIN order_items oi ON rb.order_item_id = oi.id
        INNER JOIN stores s ON rb.store_id = s.id
        INNER JOIN users u ON rb.user_id = u.id
        LEFT JOIN products p ON rb.product_id = p.id
        WHERE rb.user_id = $1::uuid
            AND ($2::text IS NULL OR rb.status = $2::"RentalBookingStatus")
        ORDER BY rb.rental_start DESC
        LIMIT $3 OFFSET $4
    `,
    [userId, status, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total FROM rental_bookings
        WHERE user_id = $1::uuid
            AND ($2::text IS NULL OR status = $2::"RentalBookingStatus")
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
    data: result.rows,
  };
};

// The store's rental diary
const vendorBookings = async (userId: string, filters: any) => {
  const store = await getVendorStore(userId);

  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const status = filters.status || null;

  const result = await query(
    `
        SELECT ${bookingDetailSelect}
        FROM rental_bookings rb
        INNER JOIN orders o ON rb.order_id = o.id
        INNER JOIN order_items oi ON rb.order_item_id = oi.id
        INNER JOIN stores s ON rb.store_id = s.id
        INNER JOIN users u ON rb.user_id = u.id
        LEFT JOIN products p ON rb.product_id = p.id
        WHERE rb.store_id = $1::uuid
            AND ($2::text IS NULL OR rb.status = $2::"RentalBookingStatus")
        ORDER BY rb.rental_start ASC
        LIMIT $3 OFFSET $4
    `,
    [store.id, status, limit, offset],
  );

  const summaryResult = await query(
    `
        SELECT
            COUNT(*) FILTER (WHERE status = 'RESERVED'::"RentalBookingStatus") as reserved,
            COUNT(*) FILTER (WHERE status = 'ACTIVE'::"RentalBookingStatus") as active,
            COUNT(*) FILTER (WHERE status = 'OVERDUE'::"RentalBookingStatus") as overdue,
            COUNT(*) FILTER (WHERE status = 'RETURNED'::"RentalBookingStatus") as returned,
            COALESCE(SUM(security_deposit) FILTER (WHERE deposit_status = 'HELD'::"DepositStatus"), 0) as deposits_held
        FROM rental_bookings
        WHERE store_id = $1::uuid
    `,
    [store.id],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total FROM rental_bookings
        WHERE store_id = $1::uuid
            AND ($2::text IS NULL OR status = $2::"RentalBookingStatus")
    `,
    [store.id, status],
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
      reserved: parseInt(summary.reserved),
      active: parseInt(summary.active),
      overdue: parseInt(summary.overdue),
      returned: parseInt(summary.returned),
      deposits_held: Number(summary.deposits_held),
    },
    data: result.rows,
  };
};

// Load a booking the vendor is allowed to touch
const getVendorBooking = async (userId: string, bookingId: string) => {
  const store = await getVendorStore(userId);

  const result = await query(
    `
        SELECT rb.*, o.order_number, o.payment_status, oi.title as item_title
        FROM rental_bookings rb
        INNER JOIN orders o ON rb.order_id = o.id
        INNER JOIN order_items oi ON rb.order_item_id = oi.id
        WHERE rb.id = $1::uuid AND rb.store_id = $2::uuid
    `,
    [bookingId, store.id],
  );

  if (result.rows.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "Rental booking not found for your store.",
    );
  }

  return { store, booking: result.rows[0] };
};

// Hand the item over to the customer
const markPickedUp = async (
  userId: string,
  bookingId: string,
  payload: any,
) => {
  const { booking } = await getVendorBooking(userId, bookingId);

  if (booking.status !== "RESERVED") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Only a reserved rental can be collected. This one is ${booking.status.toLowerCase()}.`,
    );
  }

  if (booking.payment_status !== "PAID") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This rental has not been paid for yet.",
    );
  }

  const result = await query(
    `
        UPDATE rental_bookings
        SET
            status = 'ACTIVE'::"RentalBookingStatus",
            picked_up_at = CURRENT_TIMESTAMP,
            condition_note = COALESCE($1, condition_note),
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $2::uuid
        RETURNING *
    `,
    [payload.condition_note || null, bookingId],
  );

  await enqueueNotifications({
    user_id: booking.user_id,
    type: "BOOKING_STATUS",
    title: "Rental collected",
    body: `"${booking.item_title}" is now with you. It is due back on ${new Date(booking.rental_end).toDateString()}.`,
    data: { rental_booking_id: bookingId, status: "ACTIVE" },
  });

  return result.rows[0];
};

// Take the item back and settle the deposit.
//
// A damage fee is taken out of the held deposit: the remainder goes back to the
// buyer's wallet, the fee goes to the vendor's. Both moves are ledger entries,
// so the money is always traceable.
const markReturned = async (userId: string, bookingId: string, payload: any) => {
  const { booking } = await getVendorBooking(userId, bookingId);

  if (!["ACTIVE", "OVERDUE"].includes(booking.status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Only a collected rental can be returned. This one is ${booking.status.toLowerCase()}.`,
    );
  }

  const deposit = Number(booking.security_deposit);
  const damageFee = toMoney(Number(payload.damage_fee) || 0);

  if (damageFee > deposit) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `A damage fee cannot exceed the ${deposit.toFixed(2)} deposit held.`,
    );
  }

  if (damageFee > 0 && !payload.condition_note) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Please describe the damage when charging a fee.",
    );
  }

  const refund = toMoney(deposit - damageFee);

  const depositStatus =
    deposit === 0
      ? "NONE"
      : damageFee === 0
        ? "REFUNDED"
        : refund === 0
          ? "FORFEITED"
          : "PARTIALLY_REFUNDED";

  const updated = await transaction(async (client) => {
    if (refund > 0) {
      await WalletService.applyTransaction(client, {
        userId: booking.user_id,
        type: "CREDIT",
        source: "DEPOSIT_REFUND",
        amount: refund,
        referenceType: "rental_booking",
        referenceId: bookingId,
        description: `Deposit returned for "${booking.item_title}"`,
      });
    }

    if (damageFee > 0) {
      const store = await client.query(
        `SELECT owner_id FROM stores WHERE id = $1::uuid`,
        [booking.store_id],
      );

      await WalletService.applyTransaction(client, {
        userId: store.rows[0].owner_id,
        type: "CREDIT",
        source: "DEPOSIT_FORFEIT",
        amount: damageFee,
        referenceType: "rental_booking",
        referenceId: bookingId,
        description: `Damage fee for "${booking.item_title}"`,
      });
    }

    const result = await client.query(
      `
            UPDATE rental_bookings
            SET
                status = 'RETURNED'::"RentalBookingStatus",
                returned_at = CURRENT_TIMESTAMP,
                damage_fee = $1,
                deposit_refunded_amount = $2,
                deposit_status = $3::"DepositStatus",
                deposit_settled_at = CURRENT_TIMESTAMP,
                condition_note = COALESCE($4, condition_note),
                vendor_note = COALESCE($5, vendor_note),
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $6::uuid
            RETURNING *
        `,
      [
        damageFee,
        refund,
        depositStatus,
        payload.condition_note || null,
        payload.vendor_note || null,
        bookingId,
      ],
    );

    return result.rows[0];
  });

  await enqueueNotifications({
    user_id: booking.user_id,
    type: "BOOKING_STATUS",
    title: "Rental returned",
    body:
      damageFee > 0
        ? `"${booking.item_title}" is back. A damage fee of ${damageFee.toFixed(2)} was charged and ${refund.toFixed(2)} returned to your wallet.`
        : deposit > 0
          ? `"${booking.item_title}" is back and your ${refund.toFixed(2)} deposit is in your wallet.`
          : `"${booking.item_title}" has been returned. Thank you.`,
    data: {
      rental_booking_id: bookingId,
      refund,
      damage_fee: damageFee,
    },
  });

  return updated;
};

// Flip anything past its due date to OVERDUE and nudge both sides. Run on a
// schedule; safe to call as often as you like.
const flagOverdueRentals = async () => {
  const result = await query(
    `
        UPDATE rental_bookings rb
        SET status = 'OVERDUE'::"RentalBookingStatus", "updatedAt" = CURRENT_TIMESTAMP
        WHERE rb.status = 'ACTIVE'::"RentalBookingStatus"
            AND rb.rental_end < CURRENT_TIMESTAMP
        RETURNING rb.id, rb.user_id, rb.store_id, rb.rental_end,
            (SELECT title FROM order_items WHERE id = rb.order_item_id) as item_title,
            (SELECT owner_id FROM stores WHERE id = rb.store_id) as owner_id
    `,
  );

  if (result.rows.length === 0) {
    return { flagged: 0 };
  }

  const notifications = result.rows.flatMap((row: any) => [
    {
      user_id: row.user_id,
      type: "RENTAL_DUE",
      title: "Rental overdue",
      body: `"${row.item_title}" was due back on ${new Date(row.rental_end).toDateString()}. Please return it.`,
      data: { rental_booking_id: row.id },
    },
    {
      user_id: row.owner_id,
      type: "RENTAL_DUE",
      title: "Rental not returned",
      body: `"${row.item_title}" is overdue.`,
      data: { rental_booking_id: row.id },
    },
  ]);

  await enqueueNotifications(notifications);

  return { flagged: result.rows.length };
};

export const RentalService = {
  availability,
  bookedWindows,
  myBookings,
  vendorBookings,
  markPickedUp,
  markReturned,
  flagOverdueRentals,
  // Used by the order module
  checkAvailability,
  createBookingsForOrder,
  cancelBookingsForOrder,
};
