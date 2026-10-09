import { closeDatabase, testConnection } from "./database";
import { initPhase3Enums, initPhase3Schema } from "./phase3Schema";
import dotenv from "dotenv";

dotenv.config();

const runPhase3Migrations = async () => {
  console.log("🚀 Starting Phase 3 migration...");

  try {
    // Test connections first
    const isConnected = await testConnection();
    if (!isConnected) {
      throw new Error("Could not connect to database");
    }

    // 1. ENUMs first, outside any transaction
    await initPhase3Enums();

    // 2. Staff, rental, service, chat and analytics tables
    await initPhase3Schema();

    console.log("✅ Phase 3 migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Phase 3 migration failed:", error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
};

runPhase3Migrations();
