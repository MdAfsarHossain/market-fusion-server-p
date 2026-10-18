import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { ChatService } from "./chat.service";

// Start or reuse a thread with a store - buyer
const startConversation = catchAsync(async (req: Request, res: Response) => {
  const result = await ChatService.startConversation(req.user.id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Conversation ready",
    data: result,
  });
});

// My inbox - buyer
const myConversations = catchAsync(async (req: Request, res: Response) => {
  const result = await ChatService.myConversations(req.user.id, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Conversations fetched successfully",
    data: { unreadTotal: result.unreadTotal, conversations: result.data },
    meta: result.meta,
  });
});

// Store inbox - vendor
const storeConversations = catchAsync(async (req: Request, res: Response) => {
  const result = await ChatService.storeConversations(req.user.id, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Conversations fetched successfully",
    data: { unreadTotal: result.unreadTotal, conversations: result.data },
    meta: result.meta,
  });
});

// A thread's messages
const conversationMessages = catchAsync(async (req: Request, res: Response) => {
  const result = await ChatService.conversationMessages(
    req.user.id,
    req.params.id,
    req.query,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Messages fetched successfully",
    data: { conversation: result.conversation, messages: result.data },
    meta: result.meta,
  });
});

// Mark a thread read - used when a live message lands in an open thread
const markConversationRead = catchAsync(async (req: Request, res: Response) => {
  const result = await ChatService.markConversationRead(
    req.user.id,
    req.params.id,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Conversation marked as read",
    data: result,
  });
});

// Post a message
const sendMessage = catchAsync(async (req: Request, res: Response) => {
  const result = await ChatService.sendMessage(
    req.user.id,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Message sent",
    data: result,
  });
});

// Badge count
const unreadCount = catchAsync(async (req: Request, res: Response) => {
  const result = await ChatService.unreadCount(req.user.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Unread count fetched successfully",
    data: result,
  });
});

export const ChatController = {
  startConversation,
  myConversations,
  storeConversations,
  conversationMessages,
  markConversationRead,
  sendMessage,
  unreadCount,
};
