import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { ServiceController } from "./service.controller";
import { ServiceValidation } from "./service.validation";
const route = Router();

// ─── Public ──────────────────────────────────────────────────────────────────
route.get("/slots/:productId", ServiceController.availableSlots);

// ─── Vendor: diary ───────────────────────────────────────────────────────────
route.get("/vendor/bookings", auth("VENDOR"), ServiceController.vendorBookings);

route.patch(
  "/vendor/status/:id",
  auth("VENDOR"),
  validateRequest(ServiceValidation.updateBookingStatus),
  ServiceController.updateBookingStatus,
);

route.patch(
  "/vendor/reschedule/:id",
  auth("VENDOR"),
  validateRequest(ServiceValidation.rescheduleBooking),
  ServiceController.rescheduleBooking,
);

// ─── Vendor: closures ────────────────────────────────────────────────────────
route.get("/vendor/time-off", auth("VENDOR"), ServiceController.listTimeOff);

route.post(
  "/vendor/time-off",
  auth("VENDOR"),
  validateRequest(ServiceValidation.addTimeOff),
  ServiceController.addTimeOff,
);

route.delete(
  "/vendor/time-off/:id",
  auth("VENDOR"),
  ServiceController.removeTimeOff,
);

// ─── Vendor: weekly hours ────────────────────────────────────────────────────
route.get(
  "/vendor/availability/:productId",
  auth("VENDOR"),
  ServiceController.getAvailability,
);

route.put(
  "/vendor/availability/:productId",
  auth("VENDOR"),
  validateRequest(ServiceValidation.setAvailability),
  ServiceController.setAvailability,
);

// ─── Buyer ───────────────────────────────────────────────────────────────────
route.get("/my-bookings", auth(), ServiceController.myBookings);

export const ServiceRoutes = route;
