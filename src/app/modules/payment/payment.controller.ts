import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { PaymentService } from "./payment.service";

// Create a Stripe checkout session for an order
const createCheckoutSession = catchAsync(
  async (req: Request, res: Response) => {
    const userId = req.user.id;
    const { orderId } = req.params;
    const result = await PaymentService.createCheckoutSession(userId, orderId);

    sendResponse(res, {
      statusCode: httpStatus.CREATED,
      success: true,
      message: "Checkout session created successfully",
      data: result,
    });
  },
);

// Verify a checkout session from the success page
const verifySession = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { sessionId } = req.params;
  const result = await PaymentService.verifySession(userId, sessionId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payment verified successfully",
    data: result,
  });
});

// Stripe webhook - mounted before the JSON body parser so the raw body survives
const stripeWebhook = catchAsync(async (req: Request, res: Response) => {
  const signature = req.headers["stripe-signature"] as string | undefined;
  const result = await PaymentService.handleStripeWebhook(
    req.body as Buffer,
    signature,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Webhook received successfully",
    data: result,
  });
});

// My payments
const myPayments = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await PaymentService.myPayments(userId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payments fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// All payments - admin
const allPaymentsForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await PaymentService.allPaymentsForAdmin(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Payments fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

export const PaymentController = {
  createCheckoutSession,
  verifySession,
  stripeWebhook,
  myPayments,
  allPaymentsForAdmin,
};
