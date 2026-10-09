import { Queue, Worker, type Job } from "bullmq";
import { getQueueConnection, isRedisReachable } from "../../config/queue";
import {
  NotificationService,
  type NotificationPayload,
} from "../modules/notification/notification.service";

export const NOTIFICATION_QUEUE = "notifications";

let queue: Queue | null = null;

const getQueue = () => {
  if (!queue) {
    queue = new Queue(NOTIFICATION_QUEUE, {
      connection: getQueueConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 500,
        removeOnFail: 1000,
      },
    });
  }

  return queue;
};

// Fan a notification out to one or more users.
//
// Redis is treated as an optimisation, not a dependency: if the queue cannot
// accept the job the notification is written straight to the database instead.
// A user losing a background job is acceptable; a checkout failing because
// Redis is down is not.
export const enqueueNotifications = async (
  payloads: NotificationPayload[] | NotificationPayload,
) => {
  const list = Array.isArray(payloads) ? payloads : [payloads];

  if (!list.length) {
    return;
  }

  if (isRedisReachable()) {
    try {
      await getQueue().add("send", { payloads: list });
      return;
    } catch (error: any) {
      console.error(
        "⚠️  Could not enqueue notifications, writing them inline:",
        error?.message,
      );
    }
  }

  try {
    await NotificationService.createManyNotifications(list);
  } catch (error: any) {
    // Never let a notification failure break the request that triggered it
    console.error("⚠️  Could not write notifications:", error?.message);
  }
};

let worker: Worker | null = null;

export const startNotificationWorker = () => {
  if (worker) {
    return worker;
  }

  worker = new Worker(
    NOTIFICATION_QUEUE,
    async (job: Job<{ payloads: NotificationPayload[] }>) => {
      const { payloads } = job.data;
      await NotificationService.createManyNotifications(payloads || []);
      return { written: payloads?.length || 0 };
    },
    {
      connection: getQueueConnection(),
      concurrency: 5,
    },
  );

  worker.on("failed", (job, error) => {
    console.error(
      `⚠️  Notification job ${job?.id} failed:`,
      error?.message,
    );
  });

  // BullMQ opens several connections and each retries independently, so an
  // unreachable Redis would otherwise print the same error dozens of times.
  // One line is enough: enqueueNotifications already falls back to writing
  // notifications directly to the database.
  let connectionErrorLogged = false;

  worker.on("error", (error: Error) => {
    if (connectionErrorLogged) {
      return;
    }

    connectionErrorLogged = true;
    console.error(
      "⚠️  Notification worker cannot reach Redis, notifications will be written inline:",
      error?.message,
    );
  });

  console.log("✅ Notification worker started");

  return worker;
};

export const stopNotificationWorker = async () => {
  await worker?.close().catch(() => undefined);
  await queue?.close().catch(() => undefined);
  worker = null;
  queue = null;
};
