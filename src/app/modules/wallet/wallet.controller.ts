import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { WalletService } from "./wallet.service";

// My wallet
const myWallet = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await WalletService.myWallet(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Wallet fetched successfully",
    data: result,
  });
});

// My transactions
const myTransactions = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await WalletService.myTransactions(userId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Transactions fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// Request a withdrawal
const requestWithdrawal = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await WalletService.requestWithdrawal(userId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Withdrawal requested successfully",
    data: result,
  });
});

// My withdrawals
const myWithdrawals = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await WalletService.myWithdrawals(userId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Withdrawals fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// All withdrawals - admin
const allWithdrawalsForAdmin = catchAsync(
  async (req: Request, res: Response) => {
    const result = await WalletService.allWithdrawalsForAdmin(req.query);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Withdrawals fetched successfully",
      data: result.data,
      meta: result.meta,
    });
  },
);

// Update withdrawal status - admin
const updateWithdrawalStatus = catchAsync(
  async (req: Request, res: Response) => {
    const adminId = req.user.id;
    const { id } = req.params;
    const result = await WalletService.updateWithdrawalStatus(
      adminId,
      id,
      req.body,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Withdrawal status updated successfully",
      data: result,
    });
  },
);

// Adjust a wallet - admin
const adminAdjustWallet = catchAsync(async (req: Request, res: Response) => {
  const adminId = req.user.id;
  const result = await WalletService.adminAdjustWallet(adminId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Wallet adjusted successfully",
    data: result,
  });
});

export const WalletController = {
  myWallet,
  myTransactions,
  requestWithdrawal,
  myWithdrawals,
  allWithdrawalsForAdmin,
  updateWithdrawalStatus,
  adminAdjustWallet,
};
