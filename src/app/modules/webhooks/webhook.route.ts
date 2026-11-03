import { Router } from "express";
import { WebhookController } from "./webhook.controller";
// import { WebhooksService } from "./webhooks.service";
import express from "express";

const route = Router();

// route.post("/mollie", WebhookController.molliePaymentWebhook);
route.post(
  "/mollie",
  express.raw({ type: "application/json" }),
  // WebhooksService.molliePaymentWebhook,
);
route.post("/stripe", WebhookController.stripePaymentWebhook);

export const WebhookRoute = route;
