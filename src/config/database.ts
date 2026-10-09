import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

// Connection pool for regular queries (using pooled connection)
const poolConfig = {
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true, // Keep connections alive
  keepAliveInitialDelayMillis: 10000, // Initial delay for keepalive
  statement_timeout: 30000, // Statement timeout (30 seconds)
  query_timeout: 20000, // Query timeout (20 seconds)
};

// Direct connection for migrations (using direct URL)
const directPoolConfig = {
  connectionString: process.env.DIRECT_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000, // Increased timeout
  keepAlive: true,
};

// Create connection pools
export const pool = new Pool(poolConfig);
export const directPool = new Pool(directPoolConfig);

// An idle pooled client whose socket dies emits 'error' on the Pool itself. With
// no listener that is an uncaught exception and the whole process goes down, so
// a dropped Supabase connection would take the API with it. Log it and let pg
// discard the client; the next query checks out a fresh one.
pool.on("error", (error: Error) => {
  console.error("⚠️  Idle database client error (pooled):", error.message);
});

directPool.on("error", (error: Error) => {
  console.error("⚠️  Idle database client error (direct):", error.message);
});

// Test database connection
export const testConnection = async () => {
  try {
    const client = await pool.connect();
    console.log("✅ Database connected successfully via pooled connection");
    client.release();

    const directClient = await directPool.connect();
    console.log("✅ Direct database connection successful");
    directClient.release();

    return true;
  } catch (error) {
    console.error("❌ Database connection error:", error);
    return false;
  }
};

const createEnumsWithDOBlock = async (client: any) => {
 
  await client.query(`
    DO $$ 
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PlanType') THEN
            CREATE TYPE "PlanType" AS ENUM ('PREMIUM', 'FREE');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$ 
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'Role') THEN
            CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'ADMIN', 'USER', 'BUSINESS');
        END IF;
    END $$;
  `);

  await client.query(`
    DO $$ 
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserStatus') THEN
            CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'BLOCKED', 'AVAILABLE', 'UNAVAILABLE');
        END IF;
    END $$;
  `);

  // await client.query(`
  //   DO $$ 
  //   BEGIN
  //       IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RiderStatus') THEN
  //           CREATE TYPE "RiderStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE', 'BLOCKED', 'AVAILABLE', 'UNAVAILABLE');
  //       END IF;
  //   END $$;
  // `);
};

// Initialize database tables
export const initDatabase = async () => {
  const client = await directPool.connect();
  try {
    await client.query("BEGIN");
    // -- ============================================================
    // -- ENUMS
    // -- ============================================================

    // Create all ENUM types
    console.log("📝 Creating ENUM types...");

    // Method 1: Using function
    //   await createAllEnums(client);

    // OR Method 2: Using DO blocks
    await createEnumsWithDOBlock(client);

    console.log("✅ ENUM types created successfully");

    // -- ============================================================
    // -- TABLES
    // -- ============================================================

    // -- Users
    await client.query(`CREATE TABLE IF NOT EXISTS users (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    VARCHAR(255) NOT NULL,
  phone_number            VARCHAR(50),
  email                   VARCHAR(255) UNIQUE NOT NULL,
  password                TEXT,
  address                 TEXT,
  avatar                  TEXT,
  fcm_token               TEXT,
  date_of_birth           VARCHAR(50),
  is_email_verified       BOOLEAN DEFAULT false,
  is_verified             BOOLEAN DEFAULT false,
  is_social               BOOLEAN DEFAULT false,
  is_public               BOOLEAN DEFAULT true,
  is_online               BOOLEAN DEFAULT true,
  is_business_account     BOOLEAN DEFAULT false,
  is_active               BOOLEAN DEFAULT true,
  kyc_verification_status "KycVerificationStatus" DEFAULT 'PENDING',
  last_active             TIMESTAMP,
  stripe_customer_id      TEXT,
  mollie_customer_id      TEXT,
  plan_type               "PlanType" DEFAULT 'FREE',
  role                    "Role" DEFAULT 'USER',
  status                  "UserStatus" DEFAULT 'PENDING',
  start_date              TIMESTAMP,
  next_payment_date       TIMESTAMP,
  "createdAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);`);
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_users_role             ON users (role);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_users_status           ON users (status);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_users_plan_type        ON users (plan_type);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_users_is_active        ON users (is_active);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_users_is_business      ON users (is_business_account);`,
    );
    await client.query(
      `CREATE INDEX IF NOT EXISTS idx_users_created_at       ON users ("createdAt");`,
    );



    // -- ============================================================
    // -- SECURITY: enable Row Level Security on every public table.
    // -- No policies are created, so Supabase's Data API (anon/authenticated
    // -- keys) can't read or write anything. The backend connects as the
    // -- postgres role, which bypasses RLS, so it is unaffected.
    // -- ============================================================
    console.log("📝 Enabling Row Level Security on public tables...");
    await client.query(`
      DO $$
      DECLARE r RECORD;
      BEGIN
        FOR r IN
          SELECT tablename FROM pg_tables WHERE schemaname = 'public'
        LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
        END LOOP;
      END $$;
    `);
    console.log("✅ Row Level Security enabled");

    // -- ============================================================

    await client.query("COMMIT");
    console.log("✅ Database tables and triggers created successfully");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ Database initialization error:", error);
    throw error;
  } finally {
    client.release();
  }
};

// Close all database connections
export const closeDatabase = async () => {
  await pool.end();
  await directPool.end();
  console.log("Database connections closed");
};
