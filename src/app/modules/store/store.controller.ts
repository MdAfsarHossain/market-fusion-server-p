import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { StoreService } from "./store.service";

// Create store - become a vendor
const createStore = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const files = req.files;
  const result = await StoreService.createStore(userId, req.body, files as any);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Store created successfully. It is now waiting for approval.",
    data: result,
  });
});

// My store
const myStore = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await StoreService.myStore(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Store fetched successfully",
    data: result,
  });
});

// Update my store
const updateMyStore = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const files = req.files;
  const result = await StoreService.updateMyStore(
    userId,
    req.body,
    files as any,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Store updated successfully",
    data: result,
  });
});

// All stores - public
const allStores = catchAsync(async (req: Request, res: Response) => {
  const result = await StoreService.allStores(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Stores fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// Single store by slug - public
const storeBySlug = catchAsync(async (req: Request, res: Response) => {
  const { slug } = req.params;
  const result = await StoreService.storeBySlug(slug);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Store fetched successfully",
    data: result,
  });
});

// All stores - admin
const allStoresForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await StoreService.allStoresForAdmin(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Stores fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// Approve / reject / suspend a store - admin
const updateStoreStatus = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await StoreService.updateStoreStatus(id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Store status updated successfully",
    data: result,
  });
});

export const StoreController = {
  createStore,
  myStore,
  updateMyStore,
  allStores,
  storeBySlug,
  allStoresForAdmin,
  updateStoreStatus,
};
