import { directPool } from "./database";

// -- ============================================================
// -- ENUMS
// -- ============================================================
// Runs outside a transaction on purpose, and every statement is idempotent.
const createPhase3Enums = async (client: any) => {
  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RentalBookingStatus') THEN
            CREATE TYPE "RentalBookingStatus" AS ENUM (
                'RESERVED', 'ACTIVE', 'RETURNED', 'OVERDUE', 'CANCELLED'
            );
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DepositStatus') THEN
            CREATE TYPE "DepositStatus" AS ENUM (
                'NONE', 'HELD', 'REFUNDED', 'PARTIALLY_REFUNDED', 'FORFEITED'
            );
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ServiceBookingStatus') THEN
            CREATE TYPE "ServiceBookingStatus" AS ENUM (
                'SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
            );
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StaffRole') THEN
            CREATE TYPE "StaffRole" AS ENUM ('MANAGER', 'STAFF');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StaffStatus') THEN
            CREATE TYPE "StaffStatus" AS ENUM ('INVITED', 'ACTIVE', 'REVOKED');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MessageSenderRole') THEN
            CREATE TYPE "MessageSenderRole" AS ENUM ('BUYER', 'STORE');
        END IF;
    END $$;
  `);

  // Phase 3 adds booking and chat events to the notification feed
  await client.query(`
    ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'BOOKING_STATUS';
  `);
  await client.query(`
    ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'RENTAL_DUE';
  `);
  await client.query(`
    ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'NEW_MESSAGE';
  `);
  await client.query(`
    ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'STAFF_INVITE';
  `);

  // A forfeited deposit is credited to the vendor, a refund goes to the buyer
  await client.query(`
    ALTER TYPE "WalletTxnSource" ADD VALUE IF NOT EXISTS 'DEPOSIT_REFUND';
  `);
  await client.query(`
    ALTER TYPE "WalletTxnSource" ADD VALUE IF NOT EXISTS 'DEPOSIT_FORFEIT';
  `);
};

export const initPhase3Enums = async () => {
  const client = await directPool.connect();
  try {
    console.log("📝 Creating Phase 3 ENUM types...");
    await createPhase3Enums(client);
    console.log("✅ Phase 3 ENUM types created successfully");
  } catch (error) {
    console.error("❌ Phase 3 ENUM initialization error:", error);
    throw error;
  } finally {
    client.release();
  }
};

// -- ============================================================
// -- PHASE 3 TABLES
// -- ============================================================
export const initPhase3Schema = async () => {
  const client = await directPool.connect();
  try {
    await client.query("BEGIN");

    // -- ============================================================
    // -- VENDOR STAFF
    // -- ============================================================

    // -- Extra people who can act on behalf of a store. The owner is implicit
    // -- and never appears here.
    await client.query(`CREATE TABLE IF NOT EXISTS store_staff (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role                    "StaffRole" NOT NULL DEFAULT 'STAFF',
  permissions             TEXT[] NOT NULL DEFAULT '{}',
  status                  "StaffStatus" NOT NULL DEFAULT 'INVITED',
  invited_by              UUID REFERENCES users (id) ON DELETE SET NULL,
  accepted_at             TIMESTAMP,
  revoked_at              TIMESTAMP,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT store_staff_unique UNIQUE (store_id, user_id)
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_store_staff_store    ON store_staff (store_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_store_staff_user     ON store_staff (user_id);`,
    );

    // -- ============================================================
    // -- RENTALS
    // -- ============================================================

    // -- The life of a rental after it is bought: reserved, collected,
    // -- returned, and the deposit settled.
    await client.query(`CREATE TABLE IF NOT EXISTS rental_bookings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id           UUID NOT NULL UNIQUE REFERENCES order_items (id) ON DELETE CASCADE,
  order_id                UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  sub_order_id            UUID NOT NULL REFERENCES sub_orders (id) ON DELETE CASCADE,
  product_id              UUID REFERENCES products (id) ON DELETE SET NULL,
  store_id                UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rental_start            TIMESTAMP NOT NULL,
  rental_end              TIMESTAMP NOT NULL,
  rental_units            INTEGER NOT NULL DEFAULT 1,
  quantity                INTEGER NOT NULL DEFAULT 1,
  status                  "RentalBookingStatus" NOT NULL DEFAULT 'RESERVED',
  security_deposit        NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_status          "DepositStatus" NOT NULL DEFAULT 'NONE',
  damage_fee              NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deposit_settled_at      TIMESTAMP,
  picked_up_at            TIMESTAMP,
  returned_at             TIMESTAMP,
  condition_note          TEXT,
  vendor_note             TEXT,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT rental_window_valid CHECK (rental_end > rental_start)
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_rental_bookings_store   ON rental_bookings (store_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_rental_bookings_user    ON rental_bookings (user_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_rental_bookings_status  ON rental_bookings (status);`,
    );
    // -- Availability is an overlap question, so index the window per product
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_rental_bookings_window  ON rental_bookings (product_id, rental_start, rental_end);`,
    );

    // -- ============================================================
    // -- SERVICES
    // -- ============================================================

    // -- The weekly hours a service can be booked in
    await client.query(`CREATE TABLE IF NOT EXISTS service_availability (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              UUID NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  store_id                UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  day_of_week             SMALLINT NOT NULL,
  start_time              TIME NOT NULL,
  end_time                TIME NOT NULL,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT availability_day_valid CHECK (day_of_week BETWEEN 0 AND 6),
  CONSTRAINT availability_time_valid CHECK (end_time > start_time),
  CONSTRAINT availability_unique UNIQUE (product_id, day_of_week, start_time)
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_service_avail_product   ON service_availability (product_id);`,
    );

    // -- Holidays and one-off closures, which win over the weekly hours
    await client.query(`CREATE TABLE IF NOT EXISTS service_time_off (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id                UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  product_id              UUID REFERENCES products (id) ON DELETE CASCADE,
  starts_at               TIMESTAMP NOT NULL,
  ends_at                 TIMESTAMP NOT NULL,
  reason                  VARCHAR(255),
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT time_off_valid CHECK (ends_at > starts_at)
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_time_off_store          ON service_time_off (store_id, starts_at, ends_at);`,
    );

    // -- A booked appointment, created when a service is bought
    await client.query(`CREATE TABLE IF NOT EXISTS service_bookings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_item_id           UUID NOT NULL UNIQUE REFERENCES order_items (id) ON DELETE CASCADE,
  order_id                UUID NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  sub_order_id            UUID NOT NULL REFERENCES sub_orders (id) ON DELETE CASCADE,
  product_id              UUID REFERENCES products (id) ON DELETE SET NULL,
  store_id                UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  scheduled_start         TIMESTAMP NOT NULL,
  scheduled_end           TIMESTAMP NOT NULL,
  duration_minutes        INTEGER NOT NULL,
  status                  "ServiceBookingStatus" NOT NULL DEFAULT 'SCHEDULED',
  customer_note           TEXT,
  vendor_note             TEXT,
  cancellation_reason     TEXT,
  rescheduled_from        TIMESTAMP,
  reschedule_count        INTEGER NOT NULL DEFAULT 0,
  completed_at            TIMESTAMP,
  cancelled_at            TIMESTAMP,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT booking_window_valid CHECK (scheduled_end > scheduled_start)
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_service_bookings_store  ON service_bookings (store_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_service_bookings_user   ON service_bookings (user_id);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_service_bookings_status ON service_bookings (status);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_service_bookings_window ON service_bookings (product_id, scheduled_start, scheduled_end);`,
    );

    // -- ============================================================
    // -- CHAT
    // -- ============================================================

    // -- One thread per buyer / store pair, optionally pinned to an order
    await client.query(`CREATE TABLE IF NOT EXISTS conversations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id                UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  store_id                UUID NOT NULL REFERENCES stores (id) ON DELETE CASCADE,
  order_id                UUID REFERENCES orders (id) ON DELETE SET NULL,
  subject                 VARCHAR(255),
  last_message_at         TIMESTAMP,
  last_message_preview    VARCHAR(280),
  buyer_unread_count      INTEGER NOT NULL DEFAULT 0,
  store_unread_count      INTEGER NOT NULL DEFAULT 0,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_conversations_buyer     ON conversations (buyer_id, last_message_at DESC);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_conversations_store     ON conversations (store_id, last_message_at DESC);`,
    );
    // -- A buyer gets one general thread per store, plus one per order
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_conversation_pair
      ON conversations (
        buyer_id,
        store_id,
        COALESCE(order_id, '00000000-0000-0000-0000-000000000000'::uuid)
      );
    `);

    await client.query(`CREATE TABLE IF NOT EXISTS messages (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id         UUID NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id               UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  sender_role             "MessageSenderRole" NOT NULL,
  body                    TEXT NOT NULL,
  attachments             TEXT[] NOT NULL DEFAULT '{}',
  is_read                 BOOLEAN NOT NULL DEFAULT false,
  read_at                 TIMESTAMP,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_messages_conversation   ON messages (conversation_id, "createdAt" DESC);`,
    );

    // -- ============================================================
    // -- ANALYTICS SUPPORT
    // -- ============================================================

    // -- Analytics is read from the live tables. These indexes are what keep
    // -- the per-store date-range roll-ups cheap.
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_sub_orders_store_created ON sub_orders (store_id, "createdAt");`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_order_items_store_created ON order_items (store_id, "createdAt");`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_orders_placed_at         ON orders (placed_at);`,
    );

    // -- ============================================================

    await client.query("COMMIT");
    console.log("✅ Phase 3 tables created successfully");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Phase 3 schema initialization error:", error);
    throw error;
  } finally {
    client.release();
  }
};
