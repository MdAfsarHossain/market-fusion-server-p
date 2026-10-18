import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { CouponController } from "./coupon.controller";
import { CouponValidation } from "./coupon.validation";
const route = Router();

// ─── Public ──────────────────────────────────────────────────────────────────
route.get("/available", CouponController.availableCoupons);

// ─── Buyer ───────────────────────────────────────────────────────────────────
route.post(
  "/preview",
  auth(),
  validateRequest(CouponValidation.previewCoupon),
  CouponController.previewCoupon,
);

// ─── Admin ───────────────────────────────────────────────────────────────────
route.get(
  "/admin/all",
  auth("SUPERADMIN", "ADMIN"),
  CouponController.allCouponsForAdmin,
);

// ─── Vendor ──────────────────────────────────────────────────────────────────
route.get("/my-coupons", auth("VENDOR"), CouponController.myCoupons);

// ─── Vendor or admin ─────────────────────────────────────────────────────────
route.post(
  "/create",
  auth("VENDOR", "SUPERADMIN", "ADMIN"),
  validateRequest(CouponValidation.createCoupon),
  CouponController.createCoupon,
);

route.patch(
  "/update/:id",
  auth("VENDOR", "SUPERADMIN", "ADMIN"),
  validateRequest(CouponValidation.updateCoupon),
  CouponController.updateCoupon,
);

route.delete(
  "/delete/:id",
  auth("VENDOR", "SUPERADMIN", "ADMIN"),
  CouponController.deleteCoupon,
);

export const CouponRoutes = route;
