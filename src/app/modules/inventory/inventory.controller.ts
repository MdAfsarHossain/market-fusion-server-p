import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { InventoryService } from "./inventory.service";

// My inventory - vendor
const myInventory = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await InventoryService.myInventory(userId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Inventory fetched successfully",
    data: { summary: result.summary, products: result.data },
    meta: result.meta,
  });
});

// Adjust stock - vendor
const adjustStock = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await InventoryService.adjustStock(userId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Stock updated successfully",
    data: result,
  });
});

// Update low stock threshold - vendor
const updateLowStockThreshold = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const result = await InventoryService.updateLowStockThreshold(
      userId,
      req.body,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Low stock threshold updated successfully",
      data: result,
    });
  },
);

// Stock movement history - vendor
const movements = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await InventoryService.movements(userId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Stock movements fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// Low stock across the marketplace - admin
const lowStockForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await InventoryService.lowStockForAdmin(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Low stock products fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

export const InventoryController = {
  myInventory,
  adjustStock,
  updateLowStockThreshold,
  movements,
  lowStockForAdmin,
};
