import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { CouponService } from "./coupon.service";

// Create coupon - vendor or admin
const createCoupon = catchAsync(async (req: Request, res: Response) => {
  const result = await CouponService.createCoupon(
    req.user.id,
    req.user.role,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Coupon created successfully",
    data: result,
  });
});

// Available coupons - public
const availableCoupons = catchAsync(async (req: Request, res: Response) => {
  const result = await CouponService.availableCoupons(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Coupons fetched successfully",
    data: result,
  });
});

// Preview a coupon against my cart
const previewCoupon = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await CouponService.previewCoupon(userId, req.body.code);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Coupon applied successfully",
    data: result,
  });
});

// My coupons - vendor
const myCoupons = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await CouponService.myCoupons(userId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Coupons fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// All coupons - admin
const allCouponsForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await CouponService.allCouponsForAdmin(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Coupons fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// Update coupon
const updateCoupon = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await CouponService.updateCoupon(
    req.user.id,
    req.user.role,
    id,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Coupon updated successfully",
    data: result,
  });
});

// Delete coupon
const deleteCoupon = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await CouponService.deleteCoupon(
    req.user.id,
    req.user.role,
    id,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.message,
    data: result,
  });
});

export const CouponController = {
  createCoupon,
  availableCoupons,
  previewCoupon,
  myCoupons,
  allCouponsForAdmin,
  updateCoupon,
  deleteCoupon,
};
