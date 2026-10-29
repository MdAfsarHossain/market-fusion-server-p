import catchAsync from "../../helpers/catchAsync";
import { Request, Response } from "express";
import sendResponse from "../../helpers/sendResponse";
import { UserService } from "./user.service";

// My profile
const myProfile = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await UserService.myProfile(userId);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Profile fetched successfully",
    data: result,
  });
});

// Update User
const updateUser = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const payload = req.body;
  const file = req.file;
  const result = await UserService.updateUser(userId, payload, file);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "User updated successfully",
    data: result,
  });
});

// All users
const allUsers = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const pagination = req.query;

  const result = await UserService.allUsers(userId, pagination);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Users fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

export const UserController = {
  myProfile,
  updateUser,
  allUsers,
};
