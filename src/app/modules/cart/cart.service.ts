import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { query } from "../../utils/db";
import { RentalService } from "../rental/rental.service";
import { ServiceBookingService } from "../service/service.service";

// Number of billable units between two dates for a given rental unit
const calculateRentalUnits = (
  rentalUnit: string,
  startDate: Date,
  endDate: Date,
) => {
  const milliseconds = endDate.getTime() - startDate.getTime();

  if (milliseconds <= 0) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "The rental end date must be after the start date.",
    );
  }

  const hours = milliseconds / (1000 * 60 * 60);
  const days = hours / 24;

  switch (rentalUnit) {
    case "HOUR":
      return Math.ceil(hours);
    case "WEEK":
      return Math.ceil(days / 7);
    case "MONTH":
      return Math.ceil(days / 30);
    default:
      return Math.ceil(days);
  }
};

// Fetch the user's cart, creating it the first time it is needed
const getOrCreateCart = async (userId: string) => {
  const existing = await query(
    `
        SELECT id, currency FROM carts WHERE user_id = $1::uuid
    `,
    [userId],
  );

  if (existing.rows.length > 0) {
    return existing.rows[0];
  }

  const created = await query(
    `
        INSERT INTO carts (user_id, "createdAt", "updatedAt")
        VALUES ($1::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id, currency
    `,
    [userId],
  );

  return created.rows[0];
};

// Load a purchasable product together with the details of its own type
const getPurchasableProduct = async (productId: string) => {
  const result = await query(
    `
        SELECT
            p.id,
            p.store_id,
            p.type,
            p.title,
            p.base_price,
            p.currency,
            p.stock,
            p.has_variants,
            p.status,
            p.is_active,
            s.status as store_status,
            s.is_active as store_is_active,
            (SELECT row_to_json(rp) FROM rental_products rp WHERE rp.product_id = p.id) as rental,
            (SELECT row_to_json(sp) FROM service_products sp WHERE sp.product_id = p.id) as service
        FROM products p
        INNER JOIN stores s ON p.store_id = s.id
        WHERE p.id = $1::uuid
    `,
    [productId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Product not found.");
  }

  const product = result.rows[0];

  if (product.status !== "PUBLISHED" || !product.is_active) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This product is not available for purchase.",
    );
  }

  if (product.store_status !== "ACTIVE" || !product.store_is_active) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "This store is not accepting orders right now.",
    );
  }

  return product;
};

// Resolve the price and stock of the exact line being added
const resolveLinePricing = async (product: any, payload: any) => {
  let unitPrice = Number(product.base_price);
  let availableStock = product.stock;
  let variantId: string | null = null;
  let rentalUnits: number | null = null;
  let rentalStart: Date | null = null;
  let rentalEnd: Date | null = null;
  let bookingStart: Date | null = null;

  // A product with variants must be added through one of them
  if (product.has_variants) {
    if (!payload.variant_id) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Please choose a variant for this product.",
      );
    }

    const variantResult = await query(
      `
            SELECT id, price, stock, is_active
            FROM product_variants
            WHERE id = $1::uuid AND product_id = $2::uuid
        `,
      [payload.variant_id, product.id],
    );

    if (variantResult.rows.length === 0) {
      throw new ApiError(httpStatus.NOT_FOUND, "Variant not found.");
    }

    const variant = variantResult.rows[0];

    if (!variant.is_active) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "This variant is not available right now.",
      );
    }

    variantId = variant.id;
    unitPrice = Number(variant.price);
    availableStock = variant.stock;
  }

  if (product.type === "PHYSICAL" && availableStock < payload.quantity) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Only ${availableStock} item(s) left in stock.`,
    );
  }

  if (product.type === "SERVICE") {
    if (!payload.booking_start) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "A booking date and time is required for a service.",
      );
    }

    bookingStart = new Date(payload.booking_start);

    if (bookingStart.getTime() <= Date.now()) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "The booking date must be in the future.",
      );
    }

    // Check the slot is genuinely free against the vendor's hours, their time
    // off, and appointments already in the diary. Checkout re-checks it too,
    // because a slot can fill while the item sits in the cart.
    await ServiceBookingService.assertSlotBookable(product.id, bookingStart);
  }

  if (product.type === "RENTAL") {
    if (!payload.rental_start || !payload.rental_end) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "A rental start and end date are required for a rental.",
      );
    }

    if (!product.rental) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "This rental product is not configured correctly.",
      );
    }

    rentalStart = new Date(payload.rental_start);
    rentalEnd = new Date(payload.rental_end);
    rentalUnits = calculateRentalUnits(
      product.rental.rental_unit,
      rentalStart,
      rentalEnd,
    );

    if (rentalUnits < product.rental.min_units) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `This item must be rented for at least ${product.rental.min_units} ${String(product.rental.rental_unit).toLowerCase()}(s).`,
      );
    }

    if (product.rental.max_units && rentalUnits > product.rental.max_units) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `This item can be rented for at most ${product.rental.max_units} ${String(product.rental.rental_unit).toLowerCase()}(s).`,
      );
    }

    // Availability is per window, not a flat count: units already out on other
    // dates do not block this booking, units out on overlapping dates do.
    const window = await RentalService.checkAvailability(
      product.id,
      rentalStart,
      rentalEnd,
    );

    if (payload.quantity > window.available) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        window.available === 0
          ? "This item is already booked out for those dates."
          : `Only ${window.available} unit(s) free for those dates.`,
      );
    }

    // The whole rental window is billed as one line
    unitPrice = Number(product.rental.price_per_unit) * rentalUnits;
  }

  return {
    unitPrice,
    variantId,
    rentalUnits,
    rentalStart,
    rentalEnd,
    bookingStart,
  };
};

// Add To Cart
const addToCart = async (userId: string, payload: any) => {
  const product = await getPurchasableProduct(payload.product_id);

  // A digital product or a booked service is always a single unit
  const quantity =
    product.type === "DIGITAL" || product.type === "SERVICE"
      ? 1
      : payload.quantity || 1;

  const pricing = await resolveLinePricing(product, { ...payload, quantity });
  const cart = await getOrCreateCart(userId);

  // Adding the same line twice tops up the quantity instead of duplicating it
  const existingItem = await query(
    `
        SELECT id, quantity
        FROM cart_items
        WHERE cart_id = $1::uuid
            AND product_id = $2::uuid
            AND COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid)
                = COALESCE($3::uuid, '00000000-0000-0000-0000-000000000000'::uuid)
            AND COALESCE(rental_start, '-infinity'::timestamp)
                = COALESCE($4::timestamp, '-infinity'::timestamp)
            AND COALESCE(booking_start, '-infinity'::timestamp)
                = COALESCE($5::timestamp, '-infinity'::timestamp)
    `,
    [
      cart.id,
      product.id,
      pricing.variantId,
      pricing.rentalStart,
      pricing.bookingStart,
    ],
  );

  if (existingItem.rows.length > 0) {
    const item = existingItem.rows[0];

    // A digital product or service booking can never exceed one unit
    const newQuantity =
      product.type === "DIGITAL" || product.type === "SERVICE"
        ? 1
        : item.quantity + quantity;

    const updated = await query(
      `
            UPDATE cart_items
            SET
                quantity = $1,
                unit_price = $2,
                "updatedAt" = CURRENT_TIMESTAMP
            WHERE id = $3::uuid
            RETURNING *
        `,
      [newQuantity, pricing.unitPrice, item.id],
    );

    return updated.rows[0];
  }

  const result = await query(
    `
        INSERT INTO cart_items (
            cart_id,
            product_id,
            variant_id,
            store_id,
            type,
            quantity,
            unit_price,
            rental_start,
            rental_end,
            rental_units,
            booking_start,
            "createdAt",
            "updatedAt"
        ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::"ProductType", $6, $7,
            $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        RETURNING *
    `,
    [
      cart.id,
      product.id,
      pricing.variantId,
      product.store_id,
      product.type,
      quantity,
      pricing.unitPrice,
      pricing.rentalStart,
      pricing.rentalEnd,
      pricing.rentalUnits,
      pricing.bookingStart,
    ],
  );

  return result.rows[0];
};

// My Cart - grouped per store, the way a multi vendor checkout is presented
const myCart = async (userId: string) => {
  const cart = await getOrCreateCart(userId);

  const itemsResult = await query(
    `
        SELECT
            ci.id,
            ci.product_id,
            ci.variant_id,
            ci.store_id,
            ci.type,
            ci.quantity,
            ci.unit_price,
            (ci.unit_price * ci.quantity) as line_total,
            ci.rental_start,
            ci.rental_end,
            ci.rental_units,
            ci.booking_start,
            ci."createdAt" as "createdAt",
            json_build_object(
                'id', p.id,
                'title', p.title,
                'slug', p.slug,
                'thumbnail', p.thumbnail,
                'base_price', p.base_price,
                'stock', p.stock,
                'status', p.status,
                'is_active', p.is_active,
                'currency', p.currency
            ) as product,
            CASE WHEN pv.id IS NULL THEN NULL ELSE json_build_object(
                'id', pv.id,
                'name', pv.name,
                'sku', pv.sku,
                'price', pv.price,
                'stock', pv.stock
            ) END as variant,
            json_build_object(
                'id', s.id,
                'name', s.name,
                'slug', s.slug,
                'logo', s.logo,
                'status', s.status
            ) as store
        FROM cart_items ci
        INNER JOIN products p ON ci.product_id = p.id
        INNER JOIN stores s ON ci.store_id = s.id
        LEFT JOIN product_variants pv ON ci.variant_id = pv.id
        WHERE ci.cart_id = $1::uuid
        ORDER BY s.name ASC, ci."createdAt" ASC
    `,
    [cart.id],
  );

  // Group the lines by store so the client can render one block per vendor
  const storeGroups = new Map<string, any>();
  let subtotal = 0;

  itemsResult.rows.forEach((item: any) => {
    const lineTotal = Number(item.line_total);
    subtotal += lineTotal;

    if (!storeGroups.has(item.store_id)) {
      storeGroups.set(item.store_id, {
        store: item.store,
        items: [],
        subtotal: 0,
      });
    }

    const group = storeGroups.get(item.store_id);
    group.items.push(item);
    group.subtotal = Number((group.subtotal + lineTotal).toFixed(2));
  });

  return {
    id: cart.id,
    currency: cart.currency,
    stores: Array.from(storeGroups.values()),
    summary: {
      total_items: itemsResult.rows.length,
      total_quantity: itemsResult.rows.reduce(
        (sum: number, item: any) => sum + item.quantity,
        0,
      ),
      total_stores: storeGroups.size,
      subtotal: Number(subtotal.toFixed(2)),
    },
  };
};

// Update the quantity of a cart line
const updateCartItem = async (
  userId: string,
  itemId: string,
  payload: any,
) => {
  const itemResult = await query(
    `
        SELECT ci.id, ci.type, ci.product_id, ci.variant_id
        FROM cart_items ci
        INNER JOIN carts c ON ci.cart_id = c.id
        WHERE ci.id = $1::uuid AND c.user_id = $2::uuid
    `,
    [itemId, userId],
  );

  if (itemResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Cart item not found.");
  }

  const item = itemResult.rows[0];

  if (item.type === "DIGITAL" || item.type === "SERVICE") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `The quantity of a ${item.type.toLowerCase()} item cannot be changed.`,
    );
  }

  // Re-check stock against the live product / variant
  const stockResult = await query(
    `
        SELECT COALESCE(pv.stock, p.stock) as stock
        FROM products p
        LEFT JOIN product_variants pv ON pv.id = $2::uuid
        WHERE p.id = $1::uuid
    `,
    [item.product_id, item.variant_id],
  );

  const availableStock = stockResult.rows[0]?.stock ?? 0;

  if (item.type === "PHYSICAL" && payload.quantity > availableStock) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Only ${availableStock} item(s) left in stock.`,
    );
  }

  const result = await query(
    `
        UPDATE cart_items
        SET
            quantity = $1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $2::uuid
        RETURNING *
    `,
    [payload.quantity, itemId],
  );

  return result.rows[0];
};

// Remove a single line from the cart
const removeCartItem = async (userId: string, itemId: string) => {
  const result = await query(
    `
        DELETE FROM cart_items ci
        USING carts c
        WHERE ci.cart_id = c.id
            AND ci.id = $1::uuid
            AND c.user_id = $2::uuid
        RETURNING ci.id
    `,
    [itemId, userId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Cart item not found.");
  }

  return null;
};

// Clear the whole cart
const clearCart = async (userId: string) => {
  const cart = await getOrCreateCart(userId);

  await query(`DELETE FROM cart_items WHERE cart_id = $1::uuid`, [cart.id]);

  return null;
};

export const CartService = {
  addToCart,
  myCart,
  updateCartItem,
  removeCartItem,
  clearCart,
  getOrCreateCart,
};
