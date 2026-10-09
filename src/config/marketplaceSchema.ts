import { directPool } from "./database";

// -- ============================================================
// -- ENUMS
// -- ============================================================
// Runs outside a transaction on purpose: "ALTER TYPE ... ADD VALUE" cannot be
// used in the same transaction that creates it. Every statement is idempotent.
const createMarketplaceEnums = async (client: any) => {
  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Role') THEN
            CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'ADMIN', 'USER', 'BUSINESS', 'VENDOR');
        END IF;
    END $$;
  `);

  // Older databases created "Role" without VENDOR, so add it separately
  await client.query(`
    ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'VENDOR';
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'KycVerificationStatus') THEN
            CREATE TYPE "KycVerificationStatus" AS ENUM ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StoreStatus') THEN
            CREATE TYPE "StoreStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductType') THEN
            CREATE TYPE "ProductType" AS ENUM ('PHYSICAL', 'DIGITAL', 'SERVICE', 'RENTAL');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductStatus') THEN
            CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'PENDING', 'PUBLISHED', 'REJECTED', 'ARCHIVED');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OrderStatus') THEN
            CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentStatus') THEN
            CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PaymentProvider') THEN
            CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'MOLLIE', 'WALLET', 'COD');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AddressType') THEN
            CREATE TYPE "AddressType" AS ENUM ('SHIPPING', 'BILLING');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RentalUnit') THEN
            CREATE TYPE "RentalUnit" AS ENUM ('HOUR', 'DAY', 'WEEK', 'MONTH');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ServiceMode') THEN
            CREATE TYPE "ServiceMode" AS ENUM ('ONSITE', 'REMOTE', 'HYBRID');
        END IF;
    END $$;
  `);
};

// Create every marketplace ENUM. Must run before initDatabase(), because the
// users table depends on "KycVerificationStatus".
export const initMarketplaceEnums = async () => {
  const client = await directPool.connect();
  try {
    console.log("📝 Creating marketplace ENUM types...");
    await createMarketplaceEnums(client);
    console.log("✅ Marketplace ENUM types created successfully");
  } catch (error) {
    console.error("❌ Marketplace ENUM initialization error:", error);
    throw error;
  } finally {
    client.release();
  }
};

// -- ============================================================
// -- MARKETPLACE TABLES
// -- ============================================================
export const initMarketplaceSchema = async () => {
  const client = await directPool.connect();
  try {
    await client.query("BEGIN");

    // -- OTP (used by the auth module for email verification & password reset)
    await client.query(`CREATE TABLE IF NOT EXISTS otp (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  otp_code                VARCHAR(6) NOT NULL,
  expiry                  TIMESTAMP NOT NULL,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_otp_user_id             ON otp (user_id);`,
    );

    // -- Addresses
    await client.query(`CREATE TABLE IF NOT EXISTS addresses (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  label                   VARCHAR(100),
  full_name               VARCHAR(255) NOT NULL,
  phone                   VARCHAR(50) NOT NULL,
  address_line1           TEXT NOT NULL,
  address_line2           TEXT,
  city                    VARCHAR(120) NOT NULL,
  state                   VARCHAR(120),
  postal_code             VARCHAR(30) NOT NULL,
  country                 VARCHAR(120) NOT NULL,
  type                    "AddressType" DEFAULT 'SHIPPING',
  is_default              BOOLEAN DEFAULT false,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_addresses_user_id       ON addresses (user_id);`,
    );

    // -- Stores (one store per user for Phase 1)
    await client.query(`CREATE TABLE IF NOT EXISTS stores (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  name                    VARCHAR(255) NOT NULL,
  slug                    VARCHAR(255) UNIQUE NOT NULL,
  tagline                 VARCHAR(255),
  description             TEXT,
  logo                    TEXT,
  banner                  TEXT,
  email                   VARCHAR(255),
  phone                   VARCHAR(50),
  address                 TEXT,
  city                    VARCHAR(120),
  country                 VARCHAR(120),
  status                  "StoreStatus" DEFAULT 'PENDING',
  commission_rate         NUMERIC(5,2) DEFAULT 10.00,
  is_active               BOOLEAN DEFAULT true,
  rating                  NUMERIC(3,2) DEFAULT 0,
  total_reviews           INTEGER DEFAULT 0,
  total_products          INTEGER DEFAULT 0,
  total_sales             NUMERIC(14,2) DEFAULT 0,
  rejection_reason        TEXT,
  approved_at             TIMESTAMP,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_stores_owner_id         ON stores (owner_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_stores_slug             ON stores (slug);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_stores_status           ON stores (status);`,
    );

    // -- Categories (self referencing tree)
    await client.query(`CREATE TABLE IF NOT EXISTS categories (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id               UUID REFERENCES categories (id) ON DELETE SET NULL,
  name                    VARCHAR(255) NOT NULL,
  slug                    VARCHAR(255) UNIQUE NOT NULL,
  description             TEXT,
  icon                    TEXT,
  image                   TEXT,
  product_type            "ProductType",
  sort_order              INTEGER DEFAULT 0,
  is_active               BOOLEAN DEFAULT true,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_categories_parent_id    ON categories (parent_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_categories_slug         ON categories (slug);`,
    );

    // -- Products (one row per sellable item, whatever its type)
    await client.query(`CREATE TABLE IF NOT EXISTS products (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  category_id             UUID REFERENCES categories (id) ON DELETE SET NULL,
  type                    "ProductType" NOT NULL,
  title                   VARCHAR(255) NOT NULL,
  slug                    VARCHAR(300) UNIQUE NOT NULL,
  short_description       VARCHAR(500),
  description             TEXT,
  thumbnail               TEXT,
  tags                    TEXT[] DEFAULT '{}',
  base_price              NUMERIC(12,2) NOT NULL DEFAULT 0,
  compare_at_price        NUMERIC(12,2),
  currency                VARCHAR(3) DEFAULT 'USD',
  sku                     VARCHAR(120),
  stock                   INTEGER DEFAULT 0,
  weight_gram             INTEGER,
  has_variants            BOOLEAN DEFAULT false,
  status                  "ProductStatus" DEFAULT 'DRAFT',
  is_active               BOOLEAN DEFAULT true,
  rating                  NUMERIC(3,2) DEFAULT 0,
  total_reviews           INTEGER DEFAULT 0,
  total_sold              INTEGER DEFAULT 0,
  view_count              INTEGER DEFAULT 0,
  rejection_reason        TEXT,
  published_at            TIMESTAMP,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_products_store_id       ON products (store_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_products_category_id    ON products (category_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_products_type           ON products (type);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_products_status         ON products (status);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_products_slug           ON products (slug);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_products_created_at     ON products ("createdAt");`,
    );

    // -- Product images
    await client.query(`CREATE TABLE IF NOT EXISTS product_images (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  url                     TEXT NOT NULL,
  alt                     VARCHAR(255),
  sort_order              INTEGER DEFAULT 0,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_product_images_product  ON product_images (product_id);`,
    );

    // -- Product variants (physical / rental options)
    await client.query(`CREATE TABLE IF NOT EXISTS product_variants (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  name                    VARCHAR(255) NOT NULL,
  sku                     VARCHAR(120) UNIQUE,
  price                   NUMERIC(12,2) NOT NULL,
  compare_at_price        NUMERIC(12,2),
  stock                   INTEGER DEFAULT 0,
  attributes              JSONB DEFAULT '{}'::jsonb,
  image                   TEXT,
  is_active               BOOLEAN DEFAULT true,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_variants_product_id     ON product_variants (product_id);`,
    );

    // -- Type specific details: DIGITAL
    await client.query(`CREATE TABLE IF NOT EXISTS digital_products (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL UNIQUE REFERENCES products (id) ON DELETE CASCADE,
  file_url                TEXT,
  file_key                TEXT,
  file_name               VARCHAR(255),
  file_size               BIGINT,
  mime_type               VARCHAR(120),
  version                 VARCHAR(50),
  download_limit          INTEGER DEFAULT 5,
  access_expiry_days      INTEGER,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);

    // -- Type specific details: SERVICE
    await client.query(`CREATE TABLE IF NOT EXISTS service_products (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL UNIQUE REFERENCES products (id) ON DELETE CASCADE,
  duration_minutes        INTEGER NOT NULL DEFAULT 60,
  mode                    "ServiceMode" DEFAULT 'ONSITE',
  location                TEXT,
  requires_booking        BOOLEAN DEFAULT true,
  buffer_minutes          INTEGER DEFAULT 0,
  max_daily_bookings      INTEGER DEFAULT 10,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);

    // -- Type specific details: RENTAL
    await client.query(`CREATE TABLE IF NOT EXISTS rental_products (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL UNIQUE REFERENCES products (id) ON DELETE CASCADE,
  rental_unit             "RentalUnit" DEFAULT 'DAY',
  price_per_unit          NUMERIC(12,2) NOT NULL,
  min_units               INTEGER DEFAULT 1,
  max_units               INTEGER,
  security_deposit        NUMERIC(12,2) DEFAULT 0,
  available_quantity      INTEGER DEFAULT 1,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);

    // -- Cart (one active cart per user)
    await client.query(`CREATE TABLE IF NOT EXISTS carts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  currency                VARCHAR(3) DEFAULT 'USD',
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);

    await client.query(`CREATE TABLE IF NOT EXISTS cart_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id                 UUID NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  product_id              UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  variant_id              UUID REFERENCES product_variants (id) ON DELETE CASCADE,
  store_id                UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  type                    "ProductType" NOT NULL,
  quantity                INTEGER NOT NULL DEFAULT 1,
  unit_price              NUMERIC(12,2) NOT NULL,
  rental_start            TIMESTAMP,
  rental_end              TIMESTAMP,
  rental_units            INTEGER,
  booking_start           TIMESTAMP,
  meta                    JSONB DEFAULT '{}'::jsonb,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_cart_items_cart_id      ON cart_items (cart_id);`,
    );
    // -- One line per product/variant/rental-window combination
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_cart_items_line
      ON cart_items (
        cart_id,
        product_id,
        COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
        COALESCE(rental_start, '-infinity'::timestamp),
        COALESCE(booking_start, '-infinity'::timestamp)
      );
    `);

    // -- Orders (buyer facing) --------------------------------------------
    await client.query(`CREATE TABLE IF NOT EXISTS orders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number            VARCHAR(40) UNIQUE NOT NULL,
  user_id                 UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  subtotal                NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  shipping_total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_total               NUMERIC(14,2) NOT NULL DEFAULT 0,
  grand_total             NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency                VARCHAR(3) DEFAULT 'USD',
  status                  "OrderStatus" DEFAULT 'PENDING',
  payment_status          "PaymentStatus" DEFAULT 'PENDING',
  shipping_address        JSONB,
  billing_address         JSONB,
  customer_note           TEXT,
  placed_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  cancelled_at            TIMESTAMP,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_orders_user_id          ON orders (user_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_orders_status           ON orders (status);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_orders_payment_status   ON orders (payment_status);`,
    );

    // -- Sub orders: one per vendor inside a single buyer order
    await client.query(`CREATE TABLE IF NOT EXISTS sub_orders (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  store_id                UUID NOT NULL REFERENCES stores (id) ON DELETE RESTRICT,
  sub_order_number        VARCHAR(50) UNIQUE NOT NULL,
  subtotal                NUMERIC(14,2) NOT NULL DEFAULT 0,
  shipping_total          NUMERIC(14,2) NOT NULL DEFAULT 0,
  commission_rate         NUMERIC(5,2) NOT NULL DEFAULT 0,
  commission_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  vendor_earning          NUMERIC(14,2) NOT NULL DEFAULT 0,
  grand_total             NUMERIC(14,2) NOT NULL DEFAULT 0,
  status                  "OrderStatus" DEFAULT 'PENDING',
  vendor_note             TEXT,
  cancellation_reason     TEXT,
  shipped_at              TIMESTAMP,
  delivered_at            TIMESTAMP,
  completed_at            TIMESTAMP,
  cancelled_at            TIMESTAMP,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_sub_orders_order_id     ON sub_orders (order_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_sub_orders_store_id     ON sub_orders (store_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_sub_orders_status       ON sub_orders (status);`,
    );

    // -- Order items (price/title snapshotted at checkout time)
    await client.query(`CREATE TABLE IF NOT EXISTS order_items (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  sub_order_id            UUID NOT NULL REFERENCES sub_orders (id) ON DELETE CASCADE,
  store_id                UUID NOT NULL REFERENCES stores (id) ON DELETE RESTRICT,
  product_id              UUID REFERENCES products (id) ON DELETE SET NULL,
  variant_id              UUID REFERENCES product_variants (id) ON DELETE SET NULL,
  type                    "ProductType" NOT NULL,
  title                   VARCHAR(255) NOT NULL,
  variant_name            VARCHAR(255),
  thumbnail               TEXT,
  sku                     VARCHAR(120),
  unit_price              NUMERIC(12,2) NOT NULL,
  quantity                INTEGER NOT NULL DEFAULT 1,
  line_total              NUMERIC(14,2) NOT NULL,
  rental_start            TIMESTAMP,
  rental_end              TIMESTAMP,
  rental_units            INTEGER,
  security_deposit        NUMERIC(12,2) DEFAULT 0,
  booking_start           TIMESTAMP,
  download_count          INTEGER DEFAULT 0,
  meta                    JSONB DEFAULT '{}'::jsonb,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_order_items_order_id    ON order_items (order_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_order_items_sub_order   ON order_items (sub_order_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_order_items_product_id  ON order_items (product_id);`,
    );

    // -- Order status history (audit trail)
    await client.query(`CREATE TABLE IF NOT EXISTS order_status_history (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                UUID REFERENCES orders (id) ON DELETE CASCADE,
  sub_order_id            UUID REFERENCES sub_orders (id) ON DELETE CASCADE,
  status                  "OrderStatus" NOT NULL,
  note                    TEXT,
  changed_by              UUID REFERENCES users (id) ON DELETE SET NULL,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_status_history_order    ON order_status_history (order_id);`,
    );

    // -- Payments ---------------------------------------------------------
    await client.query(`CREATE TABLE IF NOT EXISTS payments (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  provider                "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
  provider_payment_id     TEXT,
  provider_session_id     TEXT,
  amount                  NUMERIC(14,2) NOT NULL,
  currency                VARCHAR(3) DEFAULT 'USD',
  status                  "PaymentStatus" DEFAULT 'PENDING',
  method                  VARCHAR(60),
  failure_reason          TEXT,
  refunded_amount         NUMERIC(14,2) DEFAULT 0,
  paid_at                 TIMESTAMP,
  raw_response            JSONB,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_payments_order_id       ON payments (order_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_payments_session_id     ON payments (provider_session_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_payments_payment_id     ON payments (provider_payment_id);`,
    );

    // -- Payment events: webhook log + idempotency guard
    await client.query(`CREATE TABLE IF NOT EXISTS payment_events (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider                "PaymentProvider" NOT NULL DEFAULT 'STRIPE',
  event_id                TEXT UNIQUE NOT NULL,
  event_type              VARCHAR(120) NOT NULL,
  payment_id              UUID REFERENCES payments (id) ON DELETE SET NULL,
  payload                 JSONB,
  processed               BOOLEAN DEFAULT false,
  processed_at            TIMESTAMP,
  error                   TEXT,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_payment_events_event_id ON payment_events (event_id);`,
    );

    // -- ============================================================

    await client.query("COMMIT");
    console.log("✅ Marketplace tables created successfully");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Marketplace schema initialization error:", error);
    throw error;
  } finally {
    client.release();
  }
};
