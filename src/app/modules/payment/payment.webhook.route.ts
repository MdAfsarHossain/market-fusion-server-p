import express, { Router } from "express";
import { PaymentController } from "./payment.controller";
const route = Router();

// Stripe verifies the signature against the exact bytes it sent, so this route
// must be mounted in app.ts BEFORE express.json() gets a chance to consume the
// request stream.
route.post(
  "/stripe",
  express.raw({ type: "application/json" }),
  PaymentController.stripeWebhook,
);

export const PaymentWebhookRoutes = route;
