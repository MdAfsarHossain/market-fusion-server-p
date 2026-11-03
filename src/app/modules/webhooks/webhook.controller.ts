import catchAsync from "../../helpers/catchAsync";
import { Request, Response } from "express";
// import { WebhooksService } from "./webhooks.service";
import sendResponse from "../../helpers/sendResponse";

// Mollie webhook controller
const molliePaymentWebhook = catchAsync(async (req: Request, res: Response) => {
  // console.log(`Mollie payment webhook calling.....`);
  // const result = await WebhooksService.molliePaymentWebhook();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    data: "result",
    message: "Mollie payment webhook called successfully",
  });
});

// Stripe webhook controller
const stripePaymentWebhook = catchAsync(async (req: Request, res: Response) => {
  // console.log(`Stripe payment webhook calling.....`);
  // const result = await WebhooksService.stripePaymentWebhook();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    data: [],
    message: "Stripe payment webhook called successfully",
  });
});

export const WebhookController = {
  molliePaymentWebhook,
  stripePaymentWebhook,
};
