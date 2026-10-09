import { closeDatabase, testConnection } from "./database";
import { initDemoSchema } from "./demoSchema";
import { seedDemoData } from "./seedDemo";
import dotenv from "dotenv";

dotenv.config();

const runDemoMigration = async () => {
  console.log("🚀 Setting up read-only demo accounts...");

  try {
    const isConnected = await testConnection();
    if (!isConnected) {
      throw new Error("Could not connect to database");
    }

    await initDemoSchema();
    await seedDemoData();

    process.exit(0);
  } catch (error) {
    console.error("❌ Demo setup failed:", error);
    process.exit(1);
  } finally {
    await closeDatabase();
  }
};

runDemoMigration();
