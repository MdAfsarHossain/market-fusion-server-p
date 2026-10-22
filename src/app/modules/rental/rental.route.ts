import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { RentalController } from "./rental.controller";
import { RentalValidation } from "./rental.validation";
const route = Router();

// ─── Public ──────────────────────────────────────────────────────────────────
route.get("/availability/:productId", RentalController.availability);

route.get("/booked-windows/:productId", RentalController.bookedWindows);

// ─── Vendor ──────────────────────────────────────────────────────────────────
route.get("/vendor/bookings", auth("VENDOR"), RentalController.vendorBookings);

route.patch(
  "/vendor/pickup/:id",
  auth("VENDOR"),
  validateRequest(RentalValidation.markPickedUp),
  RentalController.markPickedUp,
);

route.patch(
  "/vendor/return/:id",
  auth("VENDOR"),
  validateRequest(RentalValidation.markReturned),
  RentalController.markReturned,
);

// ─── Buyer ───────────────────────────────────────────────────────────────────
route.get("/my-bookings", auth(), RentalController.myBookings);

export const RentalRoutes = route;
