import { Router } from "express";
import validateRequest from "../../middlewares/validateRequest";
import { DemoController } from "./demo.controller";
import { DemoValidation } from "./demo.validation";
const route = Router();

// Deliberately open: it only mints tokens for accounts that cannot write.
route.post(
  "/login",
  validateRequest(DemoValidation.demoLogin),
  DemoController.demoLogin,
);

export const DemoRoutes = route;
