// const redis = require("redis");

// // Create Redis client with connection options
// export const createRedisClient = async () => {
//   try {
//     const client = redis.createClient({
//       url: process.env.REDIS_URL || "redis://localhost:6379",
//       password: process.env.REDIS_PASSWORD, // Optional, only if set
//     });

//     // Event handlers for better monitoring
//     client.on("error", (err: any) => {
//       console.error("Redis Client Error:", err);
//     });

//     client.on("connect", () => {
//       console.log("✅ Redis connected successfully");
//     });

//     client.on("reconnecting", () => {
//       console.log("🔄 Redis reconnecting...");
//     });

//     // Connect to Redis
//     await client.connect();

//     return client;
//   } catch (err) {
//     console.error("❌ Failed to create Redis client:", err);

//     // Fallback in-memory client for development
//     console.log("⚠️ Using in-memory fallback for Redis");
//     return createFallbackClient();
//   }
// };

// // Fallback implementation for when Redis is unavailable
// const createFallbackClient = () => {
//   const mockStorage = new Map();

//   return {
//     get: async (key: any) => mockStorage.get(key) || null,
//     set: async (key: any, value: any, options: any) => {
//       mockStorage.set(key, value);
//       if (options?.EX) {
//         setTimeout(() => mockStorage.delete(key), options.EX * 1000);
//       }
//       return "OK";
//     },
//     del: async (key: any) => {
//       mockStorage.delete(key);
//       return 1;
//     },
//     keys: async (pattern: any) => {
//       const regex = new RegExp("^" + pattern.replace("*", ".*") + "$");
//       return Array.from(mockStorage.keys()).filter((key) => regex.test(key));
//     },
//   };
// };

// // module.exports = { createRedisClient };