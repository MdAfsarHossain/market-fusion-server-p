import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { ReviewController } from "./review.controller";
import { ReviewValidation } from "./review.validation";
const route = Router();

// ─── Public ──────────────────────────────────────────────────────────────────
route.get("/product/:productId", ReviewController.productReviews);

// ─── Admin ───────────────────────────────────────────────────────────────────
route.get(
  "/admin/all",
  auth("SUPERADMIN", "ADMIN"),
  ReviewController.allReviewsForAdmin,
);

route.patch(
  "/admin/status/:id",
  auth("SUPERADMIN", "ADMIN"),
  validateRequest(ReviewValidation.updateReviewStatus),
  ReviewController.updateReviewStatus,
);

// ─── Vendor ──────────────────────────────────────────────────────────────────
route.get("/vendor/all", auth("VENDOR"), ReviewController.vendorReviews);

route.post(
  "/vendor/reply/:id",
  auth("VENDOR"),
  validateRequest(ReviewValidation.replyToReview),
  ReviewController.replyToReview,
);

// ─── Buyer ───────────────────────────────────────────────────────────────────
route.get("/reviewable", auth(), ReviewController.reviewableItems);

route.get("/my-reviews", auth(), ReviewController.myReviews);

route.post(
  "/create",
  auth(),
  validateRequest(ReviewValidation.createReview),
  ReviewController.createReview,
);

route.patch(
  "/update/:id",
  auth(),
  validateRequest(ReviewValidation.updateReview),
  ReviewController.updateReview,
);

route.delete("/delete/:id", auth(), ReviewController.deleteReview);

export const ReviewRoutes = route;
