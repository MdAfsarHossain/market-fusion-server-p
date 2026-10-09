import { Server } from "http";
import app from "./app";
import config from "./config";
import cron from "node-cron";
import seedSuperAdmin from "./app/seedSuperAdmin";
import { WebSocketServer, WebSocket } from "ws";
import {
  setUserOnline,
  setUserOffline,
  isUserOnline,
} from "./app/lib/socketManager";
import { initDatabase } from "./config/database";
import { checkExpiredSubscriptionAndDowngrade } from "./app/utils/subscriptionsExpiresCheck";
import { query } from "./app/utils/db";
import { Server as SocketIOServer, Socket } from "socket.io";
import { setIO } from "./app/shared/socket";
import { jwtHelpers } from "./app/helpers/jwtHelpers";
import { Secret } from "jsonwebtoken";
import { startNotificationWorker } from "./app/queues/notification.queue";
import { initChatGateway } from "./app/lib/chatGateway";
import { RentalService } from "./app/modules/rental/rental.service";
import { HealthService } from "./app/modules/health/health.service";

const port = config.port || 5000;

// interface ExtendedWebSocket extends WebSocket {
//   roomId?: string;
//   userId?: string;
// }

interface CustomSocket extends Socket {
  userId?: string;
  roomId?: string;
}

async function main() {
  // Initialize database tables
  // await initDatabase();

  const server: Server = app.listen(port, () => {
    console.log("Server is running on port ", port);
    console.log(`🚀 Server running on http://localhost:${port}`);
    console.log(`📝 API Documentation: http://localhost:${port}/api/v2`);
  });
  // Awaiting nothing here on purpose, but an unhandled rejection from a slow
  // database connect would take the whole process down with it.
  seedSuperAdmin().catch((error: any) =>
    console.error("⚠️  Super admin seeding failed:", error?.message),
  );

  // =========================
  // START REALTIME CHAT
  // =========================

  // Chat works over plain HTTP too, so a socket failure must not stop the API
  try {
    const socketServer = initChatGateway(server);
    setIO(socketServer);
  } catch (error: any) {
    console.error("⚠️  Chat gateway could not start:", error?.message);
  }

  // =========================
  // START BACKGROUND WORKERS
  // =========================

  // Redis is optional: if it is unreachable, notifications are written inline
  // instead of being queued, so the API keeps working either way.
  try {
    startNotificationWorker();
  } catch (error: any) {
    console.error(
      "⚠️  Notification worker could not start, falling back to inline writes:",
      error?.message,
    );
  }

  // =========================
  // START CRON JOBS
  // =========================

  startCronJobs();
}

function startCronJobs() {
  // Run immediately on server start
  console.log("Running initial suspension check...");

  cron.schedule("0 12 * * *", async () => {
    // cron.schedule("* * * * *", async () => {
    console.log("Checking for expired subscriptions...");
    // await checkExpiredSubscriptionAndDowngrade().catch((error: any) => {
    //   console.error(
    //     "Error in checking daily expiring subscriptions cron job:",
    //     error,
    //   );
    // });
  });

  // Rentals that pass their due date are flagged hourly and both sides told
  cron.schedule("15 * * * *", async () => {
    await RentalService.flagOverdueRentals()
      .then((result) => {
        if (result.flagged > 0) {
          console.log(`Flagged ${result.flagged} overdue rental(s)`);
        }
      })
      .catch((error: any) =>
        console.error("Error flagging overdue rentals:", error?.message),
      );
  });

  // Supabase pauses a free project after about a week without database
  // activity. One cheap read a day keeps it awake with plenty of margin.
  //
  // This only fires while this process is alive, so it is not the whole answer
  // on a host that sleeps or while the server is down — point an external
  // scheduler at GET /api/v2/health for that. Both paths run the same query.
  cron.schedule("30 3 * * *", async () => {
    await HealthService.pingDatabase("cron")
      .then((result) =>
        console.log(
          `Supabase keep-alive: database reachable in ${result.latency_ms}ms`,
        ),
      )
      .catch((error: any) =>
        console.error("Supabase keep-alive failed:", error?.message),
      );
  });

  console.log(
    "Cron jobs scheduled: subscription check at 12:00 PM, overdue rentals hourly, Supabase keep-alive at 3:30 AM",
  );
}

main();
