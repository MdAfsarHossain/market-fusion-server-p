import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { ReviewService } from "./review.service";

// Create review
const createReview = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await ReviewService.createReview(userId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Review posted successfully",
    data: result,
  });
});

// Items I can review
const reviewableItems = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await ReviewService.reviewableItems(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reviewable items fetched successfully",
    data: result,
  });
});

// Reviews for a product - public
const productReviews = catchAsync(async (req: Request, res: Response) => {
  const { productId } = req.params;
  const result = await ReviewService.productReviews(productId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reviews fetched successfully",
    data: { summary: result.summary, reviews: result.data },
    meta: result.meta,
  });
});

// My reviews
const myReviews = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await ReviewService.myReviews(userId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reviews fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// Update my review
const updateReview = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { id } = req.params;
  const result = await ReviewService.updateReview(userId, id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Review updated successfully",
    data: result,
  });
});

// Delete my review
const deleteReview = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { id } = req.params;
  const result = await ReviewService.deleteReview(userId, id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Review deleted successfully",
    data: result,
  });
});

// Reviews for my store - vendor
const vendorReviews = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await ReviewService.vendorReviews(userId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reviews fetched successfully",
    data: { summary: result.summary, reviews: result.data },
    meta: result.meta,
  });
});

// Reply to a review - vendor
const replyToReview = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { id } = req.params;
  const result = await ReviewService.replyToReview(userId, id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reply posted successfully",
    data: result,
  });
});

// All reviews - admin
const allReviewsForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await ReviewService.allReviewsForAdmin(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Reviews fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// Moderate a review - admin
const updateReviewStatus = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await ReviewService.updateReviewStatus(id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Review status updated successfully",
    data: result,
  });
});

export const ReviewController = {
  createReview,
  reviewableItems,
  productReviews,
  myReviews,
  updateReview,
  deleteReview,
  vendorReviews,
  replyToReview,
  allReviewsForAdmin,
  updateReviewStatus,
};
