import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { ChatController } from "./chat.controller";
import { ChatValidation } from "./chat.validation";
const route = Router();

route.get("/unread-count", auth(), ChatController.unreadCount);

// ─── Store side ──────────────────────────────────────────────────────────────
route.get(
  "/store/conversations",
  auth("VENDOR"),
  ChatController.storeConversations,
);

// ─── Buyer side ──────────────────────────────────────────────────────────────
route.get("/conversations", auth(), ChatController.myConversations);

route.post(
  "/conversations",
  auth(),
  validateRequest(ChatValidation.startConversation),
  ChatController.startConversation,
);

// ─── Either side of a thread ─────────────────────────────────────────────────
route.get("/conversations/:id/messages", auth(), ChatController.conversationMessages);

route.post(
  "/conversations/:id/read",
  auth(),
  ChatController.markConversationRead,
);

route.post(
  "/conversations/:id/messages",
  auth(),
  validateRequest(ChatValidation.sendMessage),
  ChatController.sendMessage,
);

export const ChatRoutes = route;
