import { directPool } from "./database";

// -- ============================================================
// -- ENUMS
// -- ============================================================
// Runs outside a transaction on purpose, and every statement is idempotent.
const createPhase2Enums = async (client: any) => {
  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WalletTxnType') THEN
            CREATE TYPE "WalletTxnType" AS ENUM ('CREDIT', 'DEBIT');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WalletTxnSource') THEN
            CREATE TYPE "WalletTxnSource" AS ENUM (
                'ORDER_EARNING', 'WITHDRAWAL', 'WITHDRAWAL_REVERSAL',
                'ORDER_REFUND', 'ADMIN_ADJUSTMENT'
            );
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'WithdrawalStatus') THEN
            CREATE TYPE "WithdrawalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PAID');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DiscountType') THEN
            CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReviewStatus') THEN
            CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'PUBLISHED', 'REJECTED');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'InventoryMovementType') THEN
            CREATE TYPE "InventoryMovementType" AS ENUM (
                'SALE', 'ORDER_CANCELLED', 'RESTOCK', 'ADJUSTMENT', 'RETURN', 'INITIAL'
            );
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationType') THEN
            CREATE TYPE "NotificationType" AS ENUM (
                'ORDER_PLACED', 'ORDER_PAID', 'ORDER_STATUS', 'ORDER_CANCELLED',
                'STORE_STATUS', 'PRODUCT_STATUS', 'REVIEW_RECEIVED', 'REVIEW_REPLY',
                'WALLET_CREDIT', 'WITHDRAWAL_STATUS', 'LOW_STOCK', 'SYSTEM'
            );
        END IF;
    END $$;
  `);
};

export const initPhase2Enums = async () => {
  const client = await directPool.connect();
  try {
    console.log("📝 Creating Phase 2 ENUM types...");
    await createPhase2Enums(client);
    console.log("✅ Phase 2 ENUM types created successfully");
  } catch (error) {
    console.error("❌ Phase 2 ENUM initialization error:", error);
    throw error;
  } finally {
    client.release();
  }
};

// -- ============================================================
// -- PHASE 2 TABLES
// -- ============================================================
export const initPhase2Schema = async () => {
  const client = await directPool.connect();
  try {
    await client.query("BEGIN");

    // -- ============================================================
    // -- WALLET
    // -- ============================================================

    // -- One wallet per user. Vendors earn into it, buyers receive refunds.
    await client.query(`CREATE TABLE IF NOT EXISTS wallets (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  balance                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  pending_balance         NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency                VARCHAR(3) DEFAULT 'USD',
  total_earned            NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_withdrawn         NUMERIC(14,2) NOT NULL DEFAULT 0,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT wallets_balance_non_negative CHECK (balance >= 0)
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_wallets_user_id          ON wallets (user_id);`,
    );

    // -- Append only ledger. balance_after makes every row auditable.
    await client.query(`CREATE TABLE IF NOT EXISTS wallet_transactions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id               UUID NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type                    "WalletTxnType" NOT NULL,
  source                  "WalletTxnSource" NOT NULL,
  amount                  NUMERIC(14,2) NOT NULL,
  balance_after           NUMERIC(14,2) NOT NULL,
  currency                VARCHAR(3) DEFAULT 'USD',
  reference_type          VARCHAR(60),
  reference_id            UUID,
  description             TEXT,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_wallet_txn_wallet_id     ON wallet_transactions (wallet_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_wallet_txn_user_id       ON wallet_transactions (user_id);`,
    );
    // -- A sub order may only ever be credited once
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_txn_earning
      ON wallet_transactions (reference_id, source)
      WHERE source = 'ORDER_EARNING' AND reference_id IS NOT NULL;
    `);

    await client.query(`CREATE TABLE IF NOT EXISTS withdrawal_requests (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  wallet_id               UUID NOT NULL REFERENCES wallets (id) ON DELETE CASCADE,
  amount                  NUMERIC(14,2) NOT NULL,
  currency                VARCHAR(3) DEFAULT 'USD',
  status                  "WithdrawalStatus" DEFAULT 'PENDING',
  method                  VARCHAR(60) NOT NULL,
  account_details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  admin_note              TEXT,
  processed_by            UUID REFERENCES users (id) ON DELETE SET NULL,
  processed_at            TIMESTAMP,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT withdrawal_amount_positive CHECK (amount > 0)
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id      ON withdrawal_requests (user_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_withdrawals_status       ON withdrawal_requests (status);`,
    );

    // -- ============================================================
    // -- COUPONS
    // -- ============================================================

    // -- store_id NULL means a platform wide coupon funded by the marketplace
    await client.query(`CREATE TABLE IF NOT EXISTS coupons (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                UUID REFERENCES stores (id) ON DELETE CASCADE,
  code                    VARCHAR(60) UNIQUE NOT NULL,
  name                    VARCHAR(255) NOT NULL,
  description             TEXT,
  discount_type           "DiscountType" NOT NULL,
  discount_value          NUMERIC(12,2) NOT NULL,
  max_discount_amount     NUMERIC(12,2),
  min_order_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  usage_limit             INTEGER,
  usage_limit_per_user    INTEGER DEFAULT 1,
  used_count              INTEGER NOT NULL DEFAULT 0,
  starts_at               TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at              TIMESTAMP,
  is_active               BOOLEAN DEFAULT true,
  created_by              UUID REFERENCES users (id) ON DELETE SET NULL,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT coupon_discount_positive CHECK (discount_value > 0)
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_coupons_code             ON coupons (code);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_coupons_store_id         ON coupons (store_id);`,
    );

    await client.query(`CREATE TABLE IF NOT EXISTS coupon_usages (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id               UUID NOT NULL REFERENCES coupons (id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  order_id                UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  discount_amount         NUMERIC(12,2) NOT NULL,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon     ON coupon_usages (coupon_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_coupon_usages_user       ON coupon_usages (user_id);`,
    );
    // -- One coupon per order, counted once
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_coupon_usage_order
      ON coupon_usages (coupon_id, order_id);
    `);

    // -- ============================================================
    // -- REVIEWS
    // -- ============================================================

    // -- Tied to an order item, so only real buyers can review
    await client.query(`CREATE TABLE IF NOT EXISTS reviews (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  store_id                UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  order_item_id           UUID NOT NULL UNIQUE REFERENCES order_items (id) ON DELETE CASCADE,
  rating                  INTEGER NOT NULL,
  title                   VARCHAR(255),
  comment                 TEXT,
  images                  TEXT[] DEFAULT '{}',
  is_verified_purchase    BOOLEAN DEFAULT true,
  status                  "ReviewStatus" DEFAULT 'PUBLISHED',
  vendor_reply            TEXT,
  vendor_replied_at       TIMESTAMP,
  rejection_reason        TEXT,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT review_rating_range CHECK (rating BETWEEN 1 AND 5)
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_reviews_product_id       ON reviews (product_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_reviews_store_id         ON reviews (store_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_reviews_user_id          ON reviews (user_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_reviews_status           ON reviews (status);`,
    );

    // -- ============================================================
    // -- INVENTORY
    // -- ============================================================

    // -- Every stock change is recorded, so a vendor can audit their counts
    await client.query(`CREATE TABLE IF NOT EXISTS inventory_movements (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  variant_id              UUID REFERENCES product_variants (id) ON DELETE CASCADE,
  store_id                UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  type                    "InventoryMovementType" NOT NULL,
  quantity_change         INTEGER NOT NULL,
  quantity_after          INTEGER NOT NULL,
  reference_type          VARCHAR(60),
  reference_id            UUID,
  note                    TEXT,
  created_by              UUID REFERENCES users (id) ON DELETE SET NULL,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_inventory_product_id     ON inventory_movements (product_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_inventory_store_id       ON inventory_movements (store_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_inventory_created_at     ON inventory_movements ("createdAt");`,
    );

    // -- ============================================================
    // -- NOTIFICATIONS
    // -- ============================================================

    await client.query(`CREATE TABLE IF NOT EXISTS notifications (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type                    "NotificationType" NOT NULL,
  title                   VARCHAR(255) NOT NULL,
  body                    TEXT,
  data                    JSONB DEFAULT '{}'::jsonb,
  is_read                 BOOLEAN DEFAULT false,
  read_at                 TIMESTAMP,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_notifications_user_id    ON notifications (user_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_notifications_unread     ON notifications (user_id, is_read);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_notifications_created    ON notifications ("createdAt");`,
    );

    // -- ============================================================
    // -- PHASE 1 TABLE ADDITIONS
    // -- ============================================================

    // -- Coupons need a home on the order they discounted
    await client.query(`
      ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS coupon_id   UUID REFERENCES coupons (id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(60);
    `);

    // -- A vendor discount is charged to that vendor, not the platform
    await client.query(`
      ALTER TABLE sub_orders
        ADD COLUMN IF NOT EXISTS discount_total NUMERIC(14,2) NOT NULL DEFAULT 0;
    `);

    // -- Inventory alerting threshold, and review aggregation on products
    await client.query(`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER NOT NULL DEFAULT 5;
    `);

    // -- Buyers can only review once a sub order is done
    await client.query(`
      ALTER TABLE order_items
        ADD COLUMN IF NOT EXISTS is_reviewed BOOLEAN NOT NULL DEFAULT false;
    `);

    // -- ============================================================

    await client.query("COMMIT");
    console.log("✅ Phase 2 tables created successfully");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Phase 2 schema initialization error:", error);
    throw error;
  } finally {
    client.release();
  }
};
