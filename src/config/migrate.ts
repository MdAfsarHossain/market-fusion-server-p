import { initDatabase, closeDatabase, testConnection } from './database';
import dotenv from 'dotenv';

dotenv.config();

const runMigrations = async () => {
    console.log('🚀 Starting database migration...');

    try {
        // Test connections first
        const isConnected = await testConnection();
        if (!isConnected) {
            throw new Error('Could not connect to database');
        }

        // Initialize tables
        await initDatabase();

        console.log('✅ Migration completed successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await closeDatabase();
    }
};

runMigrations();