import { Router } from "express";
import auth from "../../middlewares/auth";
import { NotificationController } from "./notification.controller";
const route = Router();

route.get("/", auth(), NotificationController.myNotifications);

route.get("/unread-count", auth(), NotificationController.unreadCount);

route.patch("/read-all", auth(), NotificationController.markAllAsRead);

route.patch("/read/:id", auth(), NotificationController.markAsRead);

route.delete("/delete/:id", auth(), NotificationController.deleteNotification);

export const NotificationRoutes = route;
