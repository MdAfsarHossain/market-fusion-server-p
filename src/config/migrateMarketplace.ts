import { initDatabase, closeDatabase, testConnection } from "./database";
import { initMarketplaceEnums, initMarketplaceSchema } from "./marketplaceSchema";
import dotenv from "dotenv";

dotenv.config();

const runMarketplaceMigrations = async () => {
  console.log("🚀 Starting marketplace migration...");

  try {
    // Test connections first
    const isConnected = await testConnection();
    if (!isConnected) {
      throw new Error("Could not connect to database");
    }

    // 1. ENUMs first — the users table depends on "KycVerificationStatus"
    await initMarketplaceEnums();

    // 2. Core tables (users)
    await initDatabase();

    // 3. Marketplace tables
    await initMarketplaceSchema();

    console.log("✅ Marketplace migration completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Marketplace migration failed:", error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
};

runMarketplaceMigrations();
