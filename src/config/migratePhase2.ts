import { closeDatabase, testConnection } from "./database";
import { initPhase2Enums, initPhase2Schema } from "./phase2Schema";
import dotenv from "dotenv";

dotenv.config();

const runPhase2Migrations = async () => {
  console.log("🚀 Starting Phase 2 migration...");

  try {
    // Test connections first
    const isConnected = await testConnection();
    if (!isConnected) {
      throw new Error("Could not connect to database");
    }

    // 1. ENUMs first, outside any transaction
    await initPhase2Enums();

    // 2. Wallet, coupon, review, inventory and notification tables
    await initPhase2Schema();

    console.log("✅ Phase 2 migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Phase 2 migration failed:", error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
};

runPhase2Migrations();
