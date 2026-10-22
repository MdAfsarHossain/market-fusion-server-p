import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { OrderController } from "./order.controller";
import { OrderValidation } from "./order.validation";
const route = Router();

// ─── Buyer ───────────────────────────────────────────────────────────────────
route.post(
  "/checkout",
  auth(),
  validateRequest(OrderValidation.checkout),
  OrderController.checkout,
);

route.get("/my-orders", auth(), OrderController.myOrders);

route.get("/my-orders/:id", auth(), OrderController.myOrder);

route.patch(
  "/cancel/:id",
  auth(),
  validateRequest(OrderValidation.cancelOrder),
  OrderController.cancelMyOrder,
);

// ─── Vendor ──────────────────────────────────────────────────────────────────
route.get("/vendor/all", auth("VENDOR"), OrderController.vendorOrders);

route.get(
  "/vendor/:subOrderId",
  auth("VENDOR"),
  OrderController.vendorOrder,
);

route.patch(
  "/vendor/status/:subOrderId",
  auth("VENDOR"),
  validateRequest(OrderValidation.updateSubOrderStatus),
  OrderController.updateSubOrderStatus,
);

// ─── Admin ───────────────────────────────────────────────────────────────────
route.get(
  "/admin/all",
  auth("SUPERADMIN", "ADMIN"),
  OrderController.allOrdersForAdmin,
);

route.get(
  "/admin/:id",
  auth("SUPERADMIN", "ADMIN"),
  OrderController.orderForAdmin,
);

export const OrderRoutes = route;
