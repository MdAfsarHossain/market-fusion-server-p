import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import parseBodyData from "../../middlewares/parseBodyData";
import { fileUploader } from "../../middlewares/multerFileUpload";
import { StoreController } from "./store.controller";
import { StoreValidation } from "./store.validation";
const route = Router();

// ─── Public ──────────────────────────────────────────────────────────────────
route.get("/all", StoreController.allStores);

// ─── Admin ───────────────────────────────────────────────────────────────────
route.get(
  "/admin/all",
  auth("SUPERADMIN", "ADMIN"),
  StoreController.allStoresForAdmin,
);

route.patch(
  "/admin/status/:id",
  auth("SUPERADMIN", "ADMIN"),
  validateRequest(StoreValidation.updateStoreStatus),
  StoreController.updateStoreStatus,
);

// ─── Vendor ──────────────────────────────────────────────────────────────────
route.post(
  "/create",
  auth(),
  fileUploader.storeAssets,
  parseBodyData,
  validateRequest(StoreValidation.createStore),
  StoreController.createStore,
);

route.get("/my-store", auth("VENDOR", "SUPERADMIN", "ADMIN"), StoreController.myStore);

route.patch(
  "/update",
  auth("VENDOR", "SUPERADMIN", "ADMIN"),
  fileUploader.storeAssets,
  parseBodyData,
  validateRequest(StoreValidation.updateStore),
  StoreController.updateMyStore,
);

// Keep the slug route last so it never shadows the static paths above
route.get("/:slug", StoreController.storeBySlug);

export const StoreRoutes = route;
