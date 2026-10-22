import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { query, transaction } from "../../utils/db";
import { resolveStoreFor } from "../../utils/storeAccess";
import { enqueueNotifications } from "../../queues/notification.queue";

// Statuses that still occupy a slot in the diary
const BLOCKING_STATUSES = `('SCHEDULED'::"ServiceBookingStatus", 'CONFIRMED'::"ServiceBookingStatus", 'IN_PROGRESS'::"ServiceBookingStatus")`;

const getVendorStore = async (userId: string) => {
  const access = await resolveStoreFor(userId, "BOOKINGS");
  return access.store;
};

// Make sure this service product belongs to the caller's store
const getOwnedServiceProduct = async (userId: string, productId: string) => {
  const store = await getVendorStore(userId);

  const result = await query(
    `
        SELECT p.id, p.title, sp.duration_minutes, sp.buffer_minutes, sp.max_daily_bookings
        FROM products p
        INNER JOIN service_products sp ON sp.product_id = p.id
        WHERE p.id = $1::uuid AND p.store_id = $2::uuid
    `,
    [productId, store.id],
  );

  if (result.rows.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "Service product not found in your store.",
    );
  }

  return { store, product: result.rows[0] };
};

// Build "HH:MM" from a Date in UTC, matching how the stored TIME values are read
const minutesFromTime = (time: string) => {
  const [hours, minutes] = String(time).split(":").map(Number);
  return hours * 60 + (minutes || 0);
};

// Free appointment slots on one day.
//
// Slots are generated from the weekly opening hours, then anything that clashes
// with an existing booking, a time-off block, or the daily cap is removed. The
// buffer is applied on both sides so back-to-back jobs get travel time.
const availableSlots = async (productId: string, filters: any) => {
  const dateInput = filters.date;

  if (!dateInput) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Please provide a date.");
  }

  // Anchor to UTC midnight so slot maths never drifts with the server timezone
  const day = new Date(`${dateInput}T00:00:00.000Z`);

  if (Number.isNaN(day.getTime())) {
    throw new ApiError(httpStatus.BAD_REQUEST, "That date is not valid.");
  }

  const productResult = await query(
    `
        SELECT
            p.id,
            p.title,
            p.store_id,
            sp.duration_minutes,
            sp.buffer_minutes,
            sp.max_daily_bookings,
            sp.mode,
            sp.requires_booking
        FROM products p
        INNER JOIN service_products sp ON sp.product_id = p.id
        WHERE p.id = $1::uuid
    `,
    [productId],
  );

  if (productResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Service product not found.");
  }

  const product = productResult.rows[0];
  const duration = product.duration_minutes;
  const buffer = product.buffer_minutes || 0;
  const dayOfWeek = day.getUTCDay();

  const windows = await query(
    `
        SELECT start_time, end_time
        FROM service_availability
        WHERE product_id = $1::uuid AND day_of_week = $2 AND is_active = true
        ORDER BY start_time ASC
    `,
    [productId, dayOfWeek],
  );

  // Whether a schedule exists at all is a different question from whether this
  // particular day is open. Without the distinction a closed Sunday would be
  // reported as "no hours set", which sends the vendor to the wrong screen.
  const anyWindows = await query(
    `
        SELECT COUNT(*) as total
        FROM service_availability
        WHERE product_id = $1::uuid AND is_active = true
    `,
    [productId],
  );

  const dayStart = new Date(day);
  const dayEnd = new Date(day.getTime() + 86_400_000);

  const booked = await query(
    `
        SELECT scheduled_start, scheduled_end
        FROM service_bookings
        WHERE product_id = $1::uuid
            AND status IN ${BLOCKING_STATUSES}
            AND scheduled_start < $3::timestamp
            AND scheduled_end > $2::timestamp
    `,
    [productId, dayStart, dayEnd],
  );

  const timeOff = await query(
    `
        SELECT starts_at, ends_at
        FROM service_time_off
        WHERE store_id = $1::uuid
            AND (product_id IS NULL OR product_id = $2::uuid)
            AND starts_at < $4::timestamp
            AND ends_at > $3::timestamp
    `,
    [product.store_id, productId, dayStart, dayEnd],
  );

  const bookedRanges = booked.rows.map((row: any) => ({
    start: new Date(row.scheduled_start).getTime(),
    end: new Date(row.scheduled_end).getTime(),
  }));

  const blockedRanges = timeOff.rows.map((row: any) => ({
    start: new Date(row.starts_at).getTime(),
    end: new Date(row.ends_at).getTime(),
  }));

  const dailyCapReached =
    product.max_daily_bookings !== null &&
    bookedRanges.length >= product.max_daily_bookings;

  const slots: { start: string; end: string; available: boolean }[] = [];
  const now = Date.now();

  windows.rows.forEach((window: any) => {
    const openMinutes = minutesFromTime(window.start_time);
    const closeMinutes = minutesFromTime(window.end_time);

    for (
      let offset = openMinutes;
      offset + duration <= closeMinutes;
      offset += duration + buffer
    ) {
      const start = new Date(day.getTime() + offset * 60_000);
      const end = new Date(start.getTime() + duration * 60_000);

      // Buffer widens the clash test on both sides
      const guardStart = start.getTime() - buffer * 60_000;
      const guardEnd = end.getTime() + buffer * 60_000;

      const clashes = bookedRanges.some(
        (range) => range.start < guardEnd && range.end > guardStart,
      );
      const blocked = blockedRanges.some(
        (range) => range.start < end.getTime() && range.end > start.getTime(),
      );
      const inThePast = start.getTime() <= now;

      slots.push({
        start: start.toISOString(),
        end: end.toISOString(),
        available: !clashes && !blocked && !inThePast && !dailyCapReached,
      });
    }
  });

  return {
    product_id: product.id,
    title: product.title,
    date: dateInput,
    duration_minutes: duration,
    buffer_minutes: buffer,
    mode: product.mode,
    requires_booking: product.requires_booking,
    daily_cap_reached: dailyCapReached,
    has_opening_hours: parseInt(anyWindows.rows[0].total) > 0,
    is_open_today: windows.rows.length > 0,
    slots,
  };
};

// Confirm one specific start time is bookable. Used by the cart and by
// checkout, so a buyer cannot slip through a slot that just filled up.
const assertSlotBookable = async (
  productId: string,
  startsAt: Date,
  client?: any,
) => {
  const run = client
    ? (text: string, params: any[]) => client.query(text, params)
    : query;

  const productResult = await run(
    `
        SELECT p.store_id, sp.duration_minutes, sp.buffer_minutes, sp.max_daily_bookings
        FROM products p
        INNER JOIN service_products sp ON sp.product_id = p.id
        WHERE p.id = $1::uuid
    `,
    [productId],
  );

  if (productResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Service product not found.");
  }

  const product = productResult.rows[0];
  const duration = product.duration_minutes;
  const buffer = product.buffer_minutes || 0;
  const end = new Date(startsAt.getTime() + duration * 60_000);

  const guardStart = new Date(startsAt.getTime() - buffer * 60_000);
  const guardEnd = new Date(end.getTime() + buffer * 60_000);

  const clash = await run(
    `
        SELECT COUNT(*) as total
        FROM service_bookings
        WHERE product_id = $1::uuid
            AND status IN ${BLOCKING_STATUSES}
            AND scheduled_start < $3::timestamp
            AND scheduled_end > $2::timestamp
    `,
    [productId, guardStart, guardEnd],
  );

  if (parseInt(clash.rows[0].total) > 0) {
    throw new ApiError(
      httpStatus.CONFLICT,
      "That time has just been taken. Please pick another slot.",
    );
  }

  const blocked = await run(
    `
        SELECT COUNT(*) as total
        FROM service_time_off
        WHERE store_id = $1::uuid
            AND (product_id IS NULL OR product_id = $2::uuid)
            AND starts_at < $4::timestamp
            AND ends_at > $3::timestamp
    `,
    [product.store_id, productId, startsAt, end],
  );

  if (parseInt(blocked.rows[0].total) > 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "The store is unavailable at that time.",
    );
  }

  // Opening hours are only enforced when the vendor has set some
  const dayOfWeek = startsAt.getUTCDay();
  const minutes = startsAt.getUTCHours() * 60 + startsAt.getUTCMinutes();

  const hours = await run(
    `
        SELECT start_time, end_time
        FROM service_availability
        WHERE product_id = $1::uuid AND is_active = true
    `,
    [productId],
  );

  if (hours.rows.length > 0) {
    const todaysHours = await run(
      `
            SELECT start_time, end_time
            FROM service_availability
            WHERE product_id = $1::uuid AND day_of_week = $2 AND is_active = true
        `,
      [productId, dayOfWeek],
    );

    const fits = todaysHours.rows.some((window: any) => {
      const open = minutesFromTime(window.start_time);
      const close = minutesFromTime(window.end_time);
      return minutes >= open && minutes + duration <= close;
    });

    if (!fits) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "That time is outside this service's opening hours.",
      );
    }
  }

  return { scheduled_start: startsAt, scheduled_end: end, duration_minutes: duration };
};

// Turn the service lines of an order into diary entries
const createBookingsForOrder = async (client: any, orderId: string) => {
  const items = await client.query(
    `
        SELECT
            oi.id,
            oi.order_id,
            oi.sub_order_id,
            oi.product_id,
            oi.store_id,
            oi.booking_start,
            o.user_id,
            o.customer_note,
            sp.duration_minutes
        FROM order_items oi
        INNER JOIN orders o ON oi.order_id = o.id
        LEFT JOIN service_products sp ON sp.product_id = oi.product_id
        WHERE oi.order_id = $1::uuid
            AND oi.type = 'SERVICE'::"ProductType"
            AND oi.booking_start IS NOT NULL
    `,
    [orderId],
  );

  for (const item of items.rows) {
    const duration = item.duration_minutes || 60;
    const start = new Date(item.booking_start);
    const end = new Date(start.getTime() + duration * 60_000);

    await client.query(
      `
            INSERT INTO service_bookings (
                order_item_id, order_id, sub_order_id, product_id, store_id, user_id,
                scheduled_start, scheduled_end, duration_minutes, status,
                customer_note, "createdAt", "updatedAt"
            ) VALUES (
                $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
                $7, $8, $9, 'SCHEDULED'::"ServiceBookingStatus", $10,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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
        start,
        end,
        duration,
        item.customer_note || null,
      ],
    );
  }

  return items.rows.length;
};

// Free the diary when an order is cancelled
const cancelBookingsForOrder = async (
  client: any,
  orderId: string,
  reason: string,
) => {
  await client.query(
    `
        UPDATE service_bookings
        SET
            status = 'CANCELLED'::"ServiceBookingStatus",
            cancellation_reason = COALESCE(cancellation_reason, $2),
            cancelled_at = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE order_id = $1::uuid
            AND status IN ${BLOCKING_STATUSES}
    `,
    [orderId, reason],
  );
};

const bookingSelect = `
    sb.*,
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
    oi.title as item_title
`;

// The buyer's appointments
const myBookings = async (userId: string, filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const status = filters.status || null;

  const result = await query(
    `
        SELECT ${bookingSelect}
        FROM service_bookings sb
        INNER JOIN orders o ON sb.order_id = o.id
        INNER JOIN order_items oi ON sb.order_item_id = oi.id
        INNER JOIN stores s ON sb.store_id = s.id
        INNER JOIN users u ON sb.user_id = u.id
        LEFT JOIN products p ON sb.product_id = p.id
        WHERE sb.user_id = $1::uuid
            AND ($2::text IS NULL OR sb.status = $2::"ServiceBookingStatus")
        ORDER BY sb.scheduled_start DESC
        LIMIT $3 OFFSET $4
    `,
    [userId, status, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total FROM service_bookings
        WHERE user_id = $1::uuid
            AND ($2::text IS NULL OR status = $2::"ServiceBookingStatus")
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

// The store's diary
const vendorBookings = async (userId: string, filters: any) => {
  const store = await getVendorStore(userId);

  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 10;
  const offset = (page - 1) * limit;
  const status = filters.status || null;
  const from = filters.from || null;
  const to = filters.to || null;

  const result = await query(
    `
        SELECT ${bookingSelect}
        FROM service_bookings sb
        INNER JOIN orders o ON sb.order_id = o.id
        INNER JOIN order_items oi ON sb.order_item_id = oi.id
        INNER JOIN stores s ON sb.store_id = s.id
        INNER JOIN users u ON sb.user_id = u.id
        LEFT JOIN products p ON sb.product_id = p.id
        WHERE sb.store_id = $1::uuid
            AND ($2::text IS NULL OR sb.status = $2::"ServiceBookingStatus")
            AND ($3::timestamp IS NULL OR sb.scheduled_start >= $3::timestamp)
            AND ($4::timestamp IS NULL OR sb.scheduled_start <= $4::timestamp)
        ORDER BY sb.scheduled_start ASC
        LIMIT $5 OFFSET $6
    `,
    [store.id, status, from, to, limit, offset],
  );

  const summaryResult = await query(
    `
        SELECT
            COUNT(*) FILTER (WHERE status = 'SCHEDULED'::"ServiceBookingStatus") as scheduled,
            COUNT(*) FILTER (WHERE status = 'CONFIRMED'::"ServiceBookingStatus") as confirmed,
            COUNT(*) FILTER (WHERE status = 'COMPLETED'::"ServiceBookingStatus") as completed,
            COUNT(*) FILTER (
                WHERE status IN ${BLOCKING_STATUSES}
                AND scheduled_start::date = CURRENT_DATE
            ) as today
        FROM service_bookings
        WHERE store_id = $1::uuid
    `,
    [store.id],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total FROM service_bookings
        WHERE store_id = $1::uuid
            AND ($2::text IS NULL OR status = $2::"ServiceBookingStatus")
            AND ($3::timestamp IS NULL OR scheduled_start >= $3::timestamp)
            AND ($4::timestamp IS NULL OR scheduled_start <= $4::timestamp)
    `,
    [store.id, status, from, to],
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
      scheduled: parseInt(summary.scheduled),
      confirmed: parseInt(summary.confirmed),
      completed: parseInt(summary.completed),
      today: parseInt(summary.today),
    },
    data: result.rows,
  };
};

// Which status a booking may move to next
const allowedTransitions: Record<string, string[]> = {
  SCHEDULED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

// Vendor drives the appointment through its lifecycle
const updateBookingStatus = async (
  userId: string,
  bookingId: string,
  payload: any,
) => {
  const store = await getVendorStore(userId);

  const bookingResult = await query(
    `
        SELECT sb.*, oi.title as item_title, o.payment_status
        FROM service_bookings sb
        INNER JOIN order_items oi ON sb.order_item_id = oi.id
        INNER JOIN orders o ON sb.order_id = o.id
        WHERE sb.id = $1::uuid AND sb.store_id = $2::uuid
    `,
    [bookingId, store.id],
  );

  if (bookingResult.rows.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "Booking not found for your store.",
    );
  }

  const booking = bookingResult.rows[0];
  const nextStatus = payload.status;

  if (!(allowedTransitions[booking.status] || []).includes(nextStatus)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `A ${booking.status.toLowerCase()} booking cannot be moved to ${nextStatus.toLowerCase()}.`,
    );
  }

  if (nextStatus === "CANCELLED" && !payload.cancellation_reason) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "A cancellation reason is required.",
    );
  }

  const result = await query(
    `
        UPDATE service_bookings
        SET
            status = $1::"ServiceBookingStatus",
            vendor_note = COALESCE($2, vendor_note),
            cancellation_reason = CASE WHEN $1 = 'CANCELLED' THEN $3 ELSE cancellation_reason END,
            completed_at = CASE WHEN $1 = 'COMPLETED' THEN CURRENT_TIMESTAMP ELSE completed_at END,
            cancelled_at = CASE WHEN $1 = 'CANCELLED' THEN CURRENT_TIMESTAMP ELSE cancelled_at END,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $4::uuid
        RETURNING *
    `,
    [
      nextStatus,
      payload.vendor_note || null,
      payload.cancellation_reason || null,
      bookingId,
    ],
  );

  await enqueueNotifications({
    user_id: booking.user_id,
    type: "BOOKING_STATUS",
    title: `Booking ${nextStatus.toLowerCase().replace("_", " ")}`,
    body:
      nextStatus === "CANCELLED"
        ? `${store.name} cancelled your "${booking.item_title}" appointment: ${payload.cancellation_reason}`
        : `Your "${booking.item_title}" appointment is now ${nextStatus.toLowerCase().replace("_", " ")}.`,
    data: { service_booking_id: bookingId, status: nextStatus },
  });

  return result.rows[0];
};

// Move an appointment, checking the new slot is genuinely free
const rescheduleBooking = async (
  userId: string,
  bookingId: string,
  payload: any,
) => {
  const store = await getVendorStore(userId);

  const bookingResult = await query(
    `
        SELECT sb.*, oi.title as item_title
        FROM service_bookings sb
        INNER JOIN order_items oi ON sb.order_item_id = oi.id
        WHERE sb.id = $1::uuid AND sb.store_id = $2::uuid
    `,
    [bookingId, store.id],
  );

  if (bookingResult.rows.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "Booking not found for your store.",
    );
  }

  const booking = bookingResult.rows[0];

  if (!["SCHEDULED", "CONFIRMED"].includes(booking.status)) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `A ${booking.status.toLowerCase()} booking cannot be rescheduled.`,
    );
  }

  const newStart = new Date(payload.scheduled_start);

  if (newStart.getTime() <= Date.now()) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "The new time must be in the future.",
    );
  }

  const updated = await transaction(async (client) => {
    // Take this booking out of the way first, so it does not clash with itself
    await client.query(
      `
            UPDATE service_bookings
            SET status = 'CANCELLED'::"ServiceBookingStatus"
            WHERE id = $1::uuid
        `,
      [bookingId],
    );

    const slot = await assertSlotBookable(
      booking.product_id,
      newStart,
      client,
    );

    const result = await client.query(
      `
            UPDATE service_bookings
            SET
                status = $1::"ServiceBookingStatus",
                scheduled_start = $2,
                scheduled_end = $3,
                rescheduled_from = $4,
                reschedule_count = reschedule_count + 1,
                vendor_note = COALESCE($5, vendor_note),
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $6::uuid
            RETURNING *
        `,
      [
        booking.status,
        slot.scheduled_start,
        slot.scheduled_end,
        booking.scheduled_start,
        payload.vendor_note || null,
        bookingId,
      ],
    );

    return result.rows[0];
  });

  await enqueueNotifications({
    user_id: booking.user_id,
    type: "BOOKING_STATUS",
    title: "Appointment moved",
    body: `${store.name} moved your "${booking.item_title}" appointment to ${newStart.toUTCString()}.`,
    data: { service_booking_id: bookingId },
  });

  return updated;
};

// ─── Availability management ─────────────────────────────────────────────────

const getAvailability = async (userId: string, productId: string) => {
  const { product } = await getOwnedServiceProduct(userId, productId);

  const result = await query(
    `
        SELECT * FROM service_availability
        WHERE product_id = $1::uuid
        ORDER BY day_of_week ASC, start_time ASC
    `,
    [productId],
  );

  return {
    product_id: product.id,
    title: product.title,
    duration_minutes: product.duration_minutes,
    buffer_minutes: product.buffer_minutes,
    windows: result.rows,
  };
};

// Replace the whole weekly schedule in one call, which keeps the editor simple
const setAvailability = async (
  userId: string,
  productId: string,
  payload: any,
) => {
  const { store } = await getOwnedServiceProduct(userId, productId);

  const windows = payload.windows || [];

  const saved = await transaction(async (client) => {
    await client.query(
      `DELETE FROM service_availability WHERE product_id = $1::uuid`,
      [productId],
    );

    for (const window of windows) {
      await client.query(
        `
                INSERT INTO service_availability (
                    product_id, store_id, day_of_week, start_time, end_time,
                    "createdAt", "updatedAt"
                ) VALUES ($1::uuid, $2::uuid, $3, $4::time, $5::time,
                    CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT (product_id, day_of_week, start_time) DO UPDATE
                SET end_time = EXCLUDED.end_time, is_active = true
            `,
        [productId, store.id, window.day_of_week, window.start_time, window.end_time],
      );
    }

    const result = await client.query(
      `
            SELECT * FROM service_availability
            WHERE product_id = $1::uuid
            ORDER BY day_of_week ASC, start_time ASC
        `,
      [productId],
    );

    return result.rows;
  });

  return { product_id: productId, windows: saved };
};

// Holidays and closures
const listTimeOff = async (userId: string) => {
  const store = await getVendorStore(userId);

  const result = await query(
    `
        SELECT
            t.*,
            CASE WHEN p.id IS NULL THEN NULL ELSE json_build_object(
                'id', p.id, 'title', p.title
            ) END as product
        FROM service_time_off t
        LEFT JOIN products p ON t.product_id = p.id
        WHERE t.store_id = $1::uuid AND t.ends_at > CURRENT_TIMESTAMP
        ORDER BY t.starts_at ASC
    `,
    [store.id],
  );

  return result.rows;
};

const addTimeOff = async (userId: string, payload: any) => {
  const store = await getVendorStore(userId);

  if (payload.product_id) {
    await getOwnedServiceProduct(userId, payload.product_id);
  }

  const starts = new Date(payload.starts_at);
  const ends = new Date(payload.ends_at);

  if (ends <= starts) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "The end must be after the start.",
    );
  }

  const result = await query(
    `
        INSERT INTO service_time_off (store_id, product_id, starts_at, ends_at, reason, "createdAt")
        VALUES ($1::uuid, $2::uuid, $3, $4, $5, CURRENT_TIMESTAMP)
        RETURNING *
    `,
    [store.id, payload.product_id || null, starts, ends, payload.reason || null],
  );

  return result.rows[0];
};

const removeTimeOff = async (userId: string, timeOffId: string) => {
  const store = await getVendorStore(userId);

  const result = await query(
    `
        DELETE FROM service_time_off
        WHERE id = $1::uuid AND store_id = $2::uuid
        RETURNING id
    `,
    [timeOffId, store.id],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Time off entry not found.");
  }

  return null;
};

export const ServiceBookingService = {
  availableSlots,
  myBookings,
  vendorBookings,
  updateBookingStatus,
  rescheduleBooking,
  getAvailability,
  setAvailability,
  listTimeOff,
  addTimeOff,
  removeTimeOff,
  // Used by the cart and order modules
  assertSlotBookable,
  createBookingsForOrder,
  cancelBookingsForOrder,
};
