import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HttpServer } from "http";
import { Secret } from "jsonwebtoken";
import config from "../../config";
import { jwtHelpers } from "../helpers/jwtHelpers";
import { setUserOnline, setUserOffline } from "./socketManager";
import { query } from "../utils/db";

let io: SocketIOServer | null = null;

const ADMINS_ROOM = "role:admins";
const userRoom = (userId: string) => `user:${userId}`;
const conversationRoom = (conversationId: string) =>
  `conversation:${conversationId}`;

interface AuthedSocket extends Socket {
  userId?: string;
}

// Stand the realtime layer up alongside the HTTP server.
//
// Sockets carry the same JWT the REST API uses, so a connection cannot claim an
// identity the token does not prove. Everything here is additive: if the socket
// layer never starts, chat still works over plain HTTP.
export const initChatGateway = (server: HttpServer) => {
  if (io) {
    return io;
  }

  io = new SocketIOServer(server, {
    cors: {
      origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://www.resqueu-business-portal.vercel.app",
        "https://portal.business.resqueu.nl",
        "https://market-fusion-mart.vercel.app",
      ],
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/socket.io",
  });

  io.use((socket: AuthedSocket, next) => {
    try {
      const token =
        socket.handshake.auth?.token ||
        String(socket.handshake.headers.authorization || "").split(" ")[1];

      if (!token) {
        return next(new Error("No auth token provided"));
      }

      const verified = jwtHelpers.verifyToken(
        token,
        config.jwt.access_secret as Secret,
      );

      if (!verified?.id) {
        return next(new Error("Invalid auth token"));
      }

      socket.userId = verified.id;
      return next();
    } catch {
      return next(new Error("Invalid auth token"));
    }
  });

  io.on("connection", (socket: AuthedSocket) => {
    const userId = socket.userId as string;

    // A personal room means we can nudge a user about a thread they have not
    // opened yet, without them subscribing to every conversation.
    socket.join(userRoom(userId));
    setUserOnline(userId);

    // Admins also join a shared room so they see every store and product
    // status change. The role is read from the database rather than the token,
    // which can be stale after a role change.
    query(`SELECT role FROM users WHERE id = $1::uuid`, [userId])
      .then((result) => {
        const role = result.rows[0]?.role;

        if (role === "ADMIN" || role === "SUPERADMIN") {
          socket.join(ADMINS_ROOM);
        }
      })
      .catch((error: any) => {
        console.error("⚠️  Could not resolve socket role:", error?.message);
      });

    socket.on("conversation:join", (conversationId: string) => {
      if (typeof conversationId === "string" && conversationId) {
        socket.join(conversationRoom(conversationId));
      }
    });

    socket.on("conversation:leave", (conversationId: string) => {
      if (typeof conversationId === "string" && conversationId) {
        socket.leave(conversationRoom(conversationId));
      }
    });

    socket.on(
      "typing",
      (payload: { conversation_id?: string; is_typing?: boolean }) => {
        if (!payload?.conversation_id) return;

        socket.to(conversationRoom(payload.conversation_id)).emit("typing", {
          conversation_id: payload.conversation_id,
          user_id: userId,
          is_typing: Boolean(payload.is_typing),
        });
      },
    );

    socket.on("disconnect", () => {
      setUserOffline(userId);
    });
  });

  console.log("✅ Chat gateway ready on /socket.io");

  return io;
};

// Emits are best effort: a message is already committed to the database by the
// time we get here, so a missing socket layer must never surface as an error.
export const emitToConversation = (
  conversationId: string,
  event: string,
  payload: unknown,
) => {
  try {
    io?.to(conversationRoom(conversationId)).emit(event, payload);
  } catch (error: any) {
    console.error("⚠️  Socket emit failed:", error?.message);
  }
};

export const emitToUser = (
  userId: string,
  event: string,
  payload: unknown,
) => {
  try {
    io?.to(userRoom(userId)).emit(event, payload);
  } catch (error: any) {
    console.error("⚠️  Socket emit failed:", error?.message);
  }
};

export const emitToAdmins = (event: string, payload: unknown) => {
  try {
    io?.to(ADMINS_ROOM).emit(event, payload);
  } catch (error: any) {
    console.error("⚠️  Socket emit failed:", error?.message);
  }
};

export const getChatGateway = () => io;
