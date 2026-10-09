import IORedis from "ioredis";
import config from "./index";

// A single shared connection for every queue and worker. BullMQ requires
// maxRetriesPerRequest to be null, otherwise blocking commands throw.
let connection: IORedis | null = null;
let redisReachable = false;

export const getQueueConnection = (): IORedis => {
  if (connection) {
    return connection;
  }

  connection = new IORedis(config.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(config.redis.password ? { password: config.redis.password } : {}),
    // Give up reconnecting fairly quickly so a dead Redis does not spam logs
    retryStrategy: (attempts: number) =>
      attempts > 10 ? null : Math.min(attempts * 200, 3000),
  });

  connection.on("ready", () => {
    if (!redisReachable) {
      redisReachable = true;
      console.log("✅ Redis connected for background jobs");
    }
  });

  connection.on("end", () => {
    redisReachable = false;
  });

  // Without a handler an ioredis error would crash the process
  connection.on("error", (error: Error) => {
    if (redisReachable) {
      console.error("⚠️  Redis connection error:", error.message);
    }
    redisReachable = false;
  });

  return connection;
};

// Callers use this to decide whether to enqueue or fall back to doing the work
// inline. Background jobs are an optimisation here, never a hard requirement.
export const isRedisReachable = () => redisReachable;

export const closeQueueConnection = async () => {
  if (connection) {
    await connection.quit().catch(() => undefined);
    connection = null;
    redisReachable = false;
  }
};
