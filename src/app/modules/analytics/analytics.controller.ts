import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { AnalyticsService } from "./analytics.service";

// ─── Vendor ──────────────────────────────────────────────────────────────────
const vendorOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await AnalyticsService.vendorOverview(req.user.id, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Overview fetched successfully",
    data: result,
  });
});

const vendorRevenueSeries = catchAsync(async (req: Request, res: Response) => {
  const result = await AnalyticsService.vendorRevenueSeries(
    req.user.id,
    req.query,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Revenue series fetched successfully",
    data: result,
  });
});

const vendorTopProducts = catchAsync(async (req: Request, res: Response) => {
  const result = await AnalyticsService.vendorTopProducts(
    req.user.id,
    req.query,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Top products fetched successfully",
    data: result,
  });
});

const vendorSalesByType = catchAsync(async (req: Request, res: Response) => {
  const result = await AnalyticsService.vendorSalesByType(
    req.user.id,
    req.query,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sales by type fetched successfully",
    data: result,
  });
});

// ─── Admin ───────────────────────────────────────────────────────────────────
const adminOverview = catchAsync(async (req: Request, res: Response) => {
  const result = await AnalyticsService.adminOverview(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Overview fetched successfully",
    data: result,
  });
});

const adminRevenueSeries = catchAsync(async (req: Request, res: Response) => {
  const result = await AnalyticsService.adminRevenueSeries(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Revenue series fetched successfully",
    data: result,
  });
});

const adminTopStores = catchAsync(async (req: Request, res: Response) => {
  const result = await AnalyticsService.adminTopStores(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Top stores fetched successfully",
    data: result,
  });
});

const adminSalesByType = catchAsync(async (req: Request, res: Response) => {
  const result = await AnalyticsService.adminSalesByType(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Sales by type fetched successfully",
    data: result,
  });
});

export const AnalyticsController = {
  vendorOverview,
  vendorRevenueSeries,
  vendorTopProducts,
  vendorSalesByType,
  adminOverview,
  adminRevenueSeries,
  adminTopStores,
  adminSalesByType,
};
