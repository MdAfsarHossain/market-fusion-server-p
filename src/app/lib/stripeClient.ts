import Stripe from "stripe";
import httpStatus from "http-status";
import config from "../../config";
import ApiError from "../errors/ApiError";

let client: Stripe | null = null;

// Built on first use, not at import time, so the server still boots when
// STRIPE_SECRET_KEY has not been configured yet.
export const getStripeClient = (): Stripe => {
  if (!config.stripe.secret_key) {
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Stripe is not configured. Please set STRIPE_SECRET_KEY in your environment.",
    );
  }

  if (!client) {
    client = new Stripe(config.stripe.secret_key, {
      apiVersion: "2025-02-24.acacia",
      typescript: true,
    });
  }

  return client;
};
