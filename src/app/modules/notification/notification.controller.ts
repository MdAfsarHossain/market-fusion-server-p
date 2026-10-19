import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { NotificationService } from "./notification.service";

// My notifications
const myNotifications = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await NotificationService.myNotifications(userId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notifications fetched successfully",
    data: { unreadCount: result.unreadCount, notifications: result.data },
    meta: result.meta,
  });
});

// Unread count
const unreadCount = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await NotificationService.unreadCount(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Unread count fetched successfully",
    data: result,
  });
});

// Mark one as read
const markAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { id } = req.params;
  const result = await NotificationService.markAsRead(userId, id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification marked as read",
    data: result,
  });
});

// Mark all as read
const markAllAsRead = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await NotificationService.markAllAsRead(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "All notifications marked as read",
    data: result,
  });
});

// Delete a notification
const deleteNotification = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { id } = req.params;
  const result = await NotificationService.deleteNotification(userId, id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Notification deleted successfully",
    data: result,
  });
});

export const NotificationController = {
  myNotifications,
  unreadCount,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
