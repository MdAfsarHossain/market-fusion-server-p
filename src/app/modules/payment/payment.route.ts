import { Router } from "express";
import auth from "../../middlewares/auth";
import { PaymentController } from "./payment.controller";
const route = Router();

route.post(
  "/create-session/:orderId",
  auth(),
  PaymentController.createCheckoutSession,
);

route.get("/verify/:sessionId", auth(), PaymentController.verifySession);

route.get("/my-payments", auth(), PaymentController.myPayments);

route.get(
  "/admin/all",
  auth("SUPERADMIN", "ADMIN"),
  PaymentController.allPaymentsForAdmin,
);

export const PaymentRoutes = route;
