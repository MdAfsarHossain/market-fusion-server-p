import { directPool } from "./database";

// -- ============================================================
// -- DEMO ACCOUNTS
// -- ============================================================
// A single flag on users drives the read-only policy. It lives here rather than
// in the legacy users DDL so the marketplace migrations stay additive.
export const initDemoSchema = async () => {
  const client = await directPool.connect();

  try {
    await client.query("BEGIN");

    await client.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS is_demo BOOLEAN DEFAULT false;
    `);

    // The demo login endpoint looks accounts up by role among demo users only,
    // so this is the index that lookup actually uses.
    await client.query(`
        CREATE INDEX IF NOT EXISTS idx_users_is_demo
        ON users (is_demo, role)
        WHERE is_demo = true;
    `);

    await client.query("COMMIT");
    console.log("✅ Demo schema ready");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};
