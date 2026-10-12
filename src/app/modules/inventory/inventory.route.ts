import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { InventoryController } from "./inventory.controller";
import { InventoryValidation } from "./inventory.validation";
const route = Router();

// ─── Admin ───────────────────────────────────────────────────────────────────
route.get(
  "/admin/low-stock",
  auth("SUPERADMIN", "ADMIN"),
  InventoryController.lowStockForAdmin,
);

// ─── Vendor ──────────────────────────────────────────────────────────────────
route.get("/", auth("VENDOR"), InventoryController.myInventory);

route.get("/movements", auth("VENDOR"), InventoryController.movements);

route.patch(
  "/adjust",
  auth("VENDOR"),
  validateRequest(InventoryValidation.adjustStock),
  InventoryController.adjustStock,
);

route.patch(
  "/low-stock-threshold",
  auth("VENDOR"),
  validateRequest(InventoryValidation.updateLowStockThreshold),
  InventoryController.updateLowStockThreshold,
);

export const InventoryRoutes = route;
