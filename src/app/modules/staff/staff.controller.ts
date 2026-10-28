import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { StaffService } from "./staff.service";

// What can I do, and for which store
const myAccess = catchAsync(async (req: Request, res: Response) => {
  const result = await StaffService.myAccess(req.user.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Store access fetched successfully",
    data: result,
  });
});

// The team - owner only
const allStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await StaffService.allStaff(req.user.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Team fetched successfully",
    data: result,
  });
});

// Invite someone - owner only
const inviteStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await StaffService.inviteStaff(req.user.id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Invite sent successfully",
    data: result,
  });
});

// My pending invites
const myInvites = catchAsync(async (req: Request, res: Response) => {
  const result = await StaffService.myInvites(req.user.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Invites fetched successfully",
    data: result,
  });
});

// Accept an invite
const acceptInvite = catchAsync(async (req: Request, res: Response) => {
  const result = await StaffService.acceptInvite(req.user.id, req.params.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Invite accepted successfully",
    data: result,
  });
});

// Decline an invite
const declineInvite = catchAsync(async (req: Request, res: Response) => {
  const result = await StaffService.declineInvite(req.user.id, req.params.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Invite declined",
    data: result,
  });
});

// Change a team member's access - owner only
const updateStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await StaffService.updateStaff(
    req.user.id,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Team member updated successfully",
    data: result,
  });
});

// Remove a team member - owner only
const revokeStaff = catchAsync(async (req: Request, res: Response) => {
  const result = await StaffService.revokeStaff(req.user.id, req.params.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Team member removed successfully",
    data: result,
  });
});

export const StaffController = {
  myAccess,
  allStaff,
  inviteStaff,
  myInvites,
  acceptInvite,
  declineInvite,
  updateStaff,
  revokeStaff,
};
