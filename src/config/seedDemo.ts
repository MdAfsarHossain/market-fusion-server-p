import bcrypt from "bcrypt";
import { query } from "../app/utils/db";
import { StoreService } from "../app/modules/store/store.service";
import { ProductService } from "../app/modules/product/product.service";
import { CartService } from "../app/modules/cart/cart.service";
import { OrderService } from "../app/modules/order/order.service";
import { PaymentService } from "../app/modules/payment/payment.service";
import { ReviewService } from "../app/modules/review/review.service";
import { CouponService } from "../app/modules/coupon/coupon.service";
import { ChatService } from "../app/modules/chat/chat.service";
import { WalletService } from "../app/modules/wallet/wallet.service";
import { ServiceBookingService } from "../app/modules/service/service.service";

// The demo dataset is built by calling the real services rather than by writing
// rows directly. Order totals, commission splits, wallet ledger entries and
// stock movements therefore come out exactly as they would in production, and
// this seed cannot drift away from the business rules it is meant to show off.
//
// The read-only guard lives in auth(), which only sees HTTP requests, so these
// direct calls are unaffected by the is_demo flag.

const DEMO_PASSWORD = "demo1234";

export const DEMO_ACCOUNTS = {
  buyer: { email: "demo.buyer@marketfusion.dev", name: "Riya Ahmed", role: "USER" },
  vendor: { email: "demo.vendor@marketfusion.dev", name: "Nadia Karim", role: "VENDOR" },
  admin: { email: "demo.admin@marketfusion.dev", name: "Demo Admin", role: "ADMIN" },
  applicant: { email: "demo.applicant@marketfusion.dev", name: "Tanvir Hasan", role: "VENDOR" },
};

const iso = (daysFromNow: number, hour = 10) => {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

// Each enrichment step is optional: a seed that gets 90% of the way is far more
// useful than one that aborts because a slot happened to be unbookable.
const optional = async (label: string, run: () => Promise<unknown>) => {
  try {
    await run();
    console.log(`   ✓ ${label}`);
  } catch (error: any) {
    console.log(`   ! skipped ${label}: ${error?.message || error}`);
  }
};

const upsertUser = async (
  account: { email: string; name: string; role: string },
  passwordHash: string,
) => {
  const result = await query(
    `
        INSERT INTO users (
            name, email, password, phone_number, address, date_of_birth,
            role, status, is_active, is_email_verified, is_verified, is_demo,
            "createdAt", "updatedAt"
        ) VALUES (
            $1, $2, $3, $4, $5, $6,
            $7::"Role", 'ACTIVE'::"UserStatus", true, true, true, true,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (email) DO UPDATE SET is_demo = true, "updatedAt" = CURRENT_TIMESTAMP
        RETURNING id, email
    `,
    [
      account.name,
      account.email,
      passwordHash,
      "1700-0000-00",
      "12 Gulshan Avenue, Dhaka",
      "1994-05-12",
      account.role,
    ],
  );

  return result.rows[0];
};

export const seedDemoData = async () => {
  const existing = await query(
    `SELECT id FROM users WHERE email = $1 AND is_demo = true`,
    [DEMO_ACCOUNTS.buyer.email],
  );

  if (existing.rows.length > 0) {
    console.log("ℹ️  Demo accounts already exist — nothing was changed.");
    console.log("   orders.user_id and payments.user_id are ON DELETE RESTRICT,");
    console.log("   so re-seeding would mean deleting real order rows. Drop the");
    console.log("   demo users' orders by hand first if you want a clean rebuild.");
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  console.log("👤 Creating demo accounts...");
  const buyer = await upsertUser(DEMO_ACCOUNTS.buyer, passwordHash);
  const vendor = await upsertUser(DEMO_ACCOUNTS.vendor, passwordHash);
  const admin = await upsertUser(DEMO_ACCOUNTS.admin, passwordHash);
  const applicant = await upsertUser(DEMO_ACCOUNTS.applicant, passwordHash);

  console.log("🏪 Opening the demo store...");
  const store: any = await StoreService.createStore(vendor.id, {
    name: "Aurora Supply Co.",
    tagline: "Considered tools for people who make things",
    description:
      "A small studio shop in Dhaka. We sell the lighting and camera gear we " +
      "use ourselves, licence our own presets, and rent out the kit we are not " +
      "using that week.",
    email: "hello@aurorasupply.example",
    phone: "1700-0000-01",
    city: "Dhaka",
    country: "Bangladesh",
  });
  await StoreService.updateStoreStatus(store.id, {
    status: "ACTIVE",
    commission_rate: 10,
  });

  // Leaves one store in the admin approval queue, so that page is not empty
  await optional("a pending store for the admin queue", async () => {
    await StoreService.createStore(applicant.id, {
      name: "Meridian Outdoors",
      tagline: "Trail and camping gear",
      city: "Chattogram",
      country: "Bangladesh",
    });
  });

  console.log("📦 Publishing one product of each type...");
  const publish = async (payload: any) => {
    const product: any = await ProductService.createProduct(vendor.id, payload);
    await ProductService.updateProductStatus(product.id, { status: "PUBLISHED" });
    return product;
  };

  const lamp = await publish({
    type: "PHYSICAL",
    title: "Aurora Desk Lamp",
    short_description: "Warm 2700K desk lamp with a weighted brass base.",
    description:
      "A desk lamp built for long evenings: stepless dimming, a 2700K panel " +
      "that does not buzz, and a base heavy enough to stay put when you knock it.",
    base_price: 48,
    compare_at_price: 62,
    stock: 40,
    sku: "AUR-LAMP-01",
    weight_gram: 1600,
    tags: ["lighting", "desk", "studio"],
    low_stock_threshold: 8,
  });

  const presets = await publish({
    type: "DIGITAL",
    title: "Nordic Light — Lightroom Preset Pack",
    short_description: "24 presets for overcast and low-sun conditions.",
    description:
      "The develop settings behind our own product photography, packaged as " +
      "24 presets. Works in Lightroom Classic and CC.",
    base_price: 19,
    tags: ["presets", "editing"],
    digital: { file_name: "nordic-light-v2.zip", version: "2.0", download_limit: 5 },
  });

  const session = await publish({
    type: "SERVICE",
    title: "Product Photography Session — 1 hour",
    short_description: "A one-hour studio session, edited shots included.",
    description:
      "Bring up to eight products. You leave with ten edited images, shot on " +
      "seamless white or a textured surface, whichever suits the range.",
    base_price: 75,
    tags: ["photography", "studio"],
    service: {
      duration_minutes: 60,
      mode: "ONSITE",
      location: "Studio 4, Gulshan, Dhaka",
      requires_booking: true,
      buffer_minutes: 15,
      max_daily_bookings: 4,
    },
  });

  const cameraKit = await publish({
    type: "RENTAL",
    title: "Sony A7 III Kit — body, 24-70mm, two batteries",
    short_description: "Full-frame kit for a shoot, by the day.",
    description:
      "Body, 24-70mm f/2.8, two charged batteries, a 64GB card and a padded " +
      "bag. Checked and cleaned between every rental.",
    tags: ["camera", "rental"],
    rental: {
      rental_unit: "DAY",
      price_per_unit: 35,
      min_units: 2,
      max_units: 14,
      security_deposit: 200,
    },
  });

  await optional("weekly opening hours for the service", async () => {
    await ServiceBookingService.setAvailability(vendor.id, session.id, {
      windows: [1, 2, 3, 4, 6].map((day) => ({
        day_of_week: day,
        start_time: "09:00",
        end_time: "18:00",
      })),
    });
  });

  await optional("a store coupon", async () => {
    await CouponService.createCoupon(vendor.id, "VENDOR", {
      code: "AURORA10",
      name: "10% off your first order",
      description: "Welcome discount for new customers of Aurora Supply Co.",
      discount_type: "PERCENTAGE",
      discount_value: 10,
      min_order_amount: 30,
      max_discount_amount: 25,
      usage_limit: 200,
      usage_limit_per_user: 1,
      expires_at: iso(120),
    });
  });

  const address = {
    full_name: "Riya Ahmed",
    phone: "1700-0000-02",
    address_line1: "House 42, Road 11",
    address_line2: "Banani",
    city: "Dhaka",
    state: "Dhaka",
    postal_code: "1213",
    country: "Bangladesh",
  };

  console.log("🧾 Placing a completed order (earnings, review, wallet)...");
  await CartService.addToCart(buyer.id, { product_id: lamp.id, quantity: 2 });
  await CartService.addToCart(buyer.id, { product_id: presets.id, quantity: 1 });
  const completedOrder: any = await OrderService.checkout(buyer.id, {
    shipping_address: address,
    customer_note: "Please pack the lamp well, it is a gift.",
  });

  // Stands in for the Stripe webhook. Using the service the webhook itself
  // calls means the money, counters and sub order states all move together.
  await PaymentService.markOrderAsPaid(completedOrder.id, {
    method: "CARD",
    provider_payment_id: "demo_seed_payment",
  });

  const completedSub = completedOrder.sub_orders?.[0];
  if (completedSub) {
    for (const status of ["PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"]) {
      await OrderService.updateSubOrderStatus(vendor.id, completedSub.id, {
        status,
        vendor_note:
          status === "SHIPPED" ? "Handed to the courier this morning." : undefined,
      });
    }
  }

  await optional("a review with a vendor reply", async () => {
    const item = await query(
      `
        SELECT oi.id FROM order_items oi
        WHERE oi.order_id = $1::uuid AND oi.product_id = $2::uuid
        LIMIT 1
      `,
      [completedOrder.id, lamp.id],
    );

    if (item.rows.length === 0) throw new Error("no reviewable item");

    const review: any = await ReviewService.createReview(buyer.id, {
      order_item_id: item.rows[0].id,
      rating: 5,
      title: "Does exactly what I wanted",
      comment:
        "The dimming goes genuinely low, which is the whole reason I bought it. " +
        "Base is heavy enough that it does not slide when I move the arm.",
    });

    await ReviewService.replyToReview(vendor.id, review.id, {
      reply: "Thank you Riya — glad the low end is working out for you.",
    });
  });

  console.log("🧾 Placing a paid order still being prepared...");
  await optional("a rental order in progress", async () => {
    await CartService.addToCart(buyer.id, {
      product_id: cameraKit.id,
      quantity: 1,
      rental_start: iso(6, 9),
      rental_end: iso(9, 18),
    });
    const rentalOrder: any = await OrderService.checkout(buyer.id, {
      shipping_address: address,
    });
    await PaymentService.markOrderAsPaid(rentalOrder.id, {
      method: "CARD",
      provider_payment_id: "demo_seed_payment_2",
    });
    if (rentalOrder.sub_orders?.[0]) {
      await OrderService.updateSubOrderStatus(vendor.id, rentalOrder.sub_orders[0].id, {
        status: "PROCESSING",
      });
    }
  });

  await optional("a booked photography session", async () => {
    // Ask the service which slots it is actually offering rather than guessing a
    // time: slot maths is anchored to UTC, so a local hour picked here would
    // land outside the opening hours on any server not running at UTC.
    let chosen: string | null = null;

    for (let dayOffset = 3; dayOffset <= 12 && !chosen; dayOffset++) {
      const date = new Date();
      date.setDate(date.getDate() + dayOffset);

      const offered: any = await ServiceBookingService.availableSlots(session.id, {
        date: date.toISOString().slice(0, 10),
      });

      chosen =
        offered.slots?.find((slot: any) => slot.available)?.start ?? null;
    }

    if (!chosen) throw new Error("no bookable slot in the next two weeks");

    await CartService.addToCart(buyer.id, {
      product_id: session.id,
      quantity: 1,
      booking_start: chosen,
    });
    const bookingOrder: any = await OrderService.checkout(buyer.id, {
      shipping_address: address,
    });
    await PaymentService.markOrderAsPaid(bookingOrder.id, {
      method: "CARD",
      provider_payment_id: "demo_seed_payment_3",
    });
  });

  console.log("🧾 Leaving one order awaiting payment...");
  await optional("an unpaid order", async () => {
    await CartService.addToCart(buyer.id, { product_id: lamp.id, quantity: 1 });
    await OrderService.checkout(buyer.id, { shipping_address: address });
  });

  await optional("a withdrawal request for the admin payouts queue", async () => {
    const wallet: any = await WalletService.myWallet(vendor.id);
    const available = Number(wallet?.available_balance ?? 0);

    if (available < 10) throw new Error("not enough demo earnings yet");

    await WalletService.requestWithdrawal(vendor.id, {
      amount: Math.min(available, 50),
      method: "BANK_TRANSFER",
      account_details: {
        bank_name: "Demo Bank",
        account_name: "Aurora Supply Co.",
        account_number: "00012345678",
      },
    });
  });

  await optional("a conversation between the buyer and the store", async () => {
    const conversation: any = await ChatService.startConversation(buyer.id, {
      store_id: store.id,
      subject: "Question about the desk lamp",
    });
    await ChatService.sendMessage(buyer.id, conversation.id, {
      body: "Is the lamp arm stiff enough to hold at a low angle?",
    });
    await ChatService.sendMessage(vendor.id, conversation.id, {
      body: "It is — the friction is adjustable with the hex key in the box.",
    });
    await ChatService.sendMessage(buyer.id, conversation.id, {
      body: "Perfect, ordered. Thanks!",
    });
  });

  // Last, because checkout empties the cart: this leaves /cart and /checkout
  // with something to show.
  await optional("items waiting in the cart", async () => {
    await CartService.addToCart(buyer.id, { product_id: presets.id, quantity: 1 });
    await CartService.addToCart(buyer.id, { product_id: lamp.id, quantity: 1 });
  });

  console.log("");
  console.log("✅ Demo data ready");
  console.log(`   buyer   ${DEMO_ACCOUNTS.buyer.email}`);
  console.log(`   vendor  ${DEMO_ACCOUNTS.vendor.email}  (Aurora Supply Co.)`);
  console.log(`   admin   ${DEMO_ACCOUNTS.admin.email}`);
  console.log(`   password for all: ${DEMO_PASSWORD} (or use the Test User button)`);
  console.log(`   every one of them is read-only: is_demo = true`);
  void admin;
};
