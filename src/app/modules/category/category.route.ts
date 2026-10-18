import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import parseBodyData from "../../middlewares/parseBodyData";
import { fileUploader } from "../../middlewares/multerFileUpload";
import { CategoryController } from "./category.controller";
import { CategoryValidation } from "./category.validation";
const route = Router();

// ─── Public ──────────────────────────────────────────────────────────────────
route.get("/all", CategoryController.allCategories);

route.get("/tree", CategoryController.categoryTree);

// ─── Admin ───────────────────────────────────────────────────────────────────
route.post(
  "/create",
  auth("SUPERADMIN", "ADMIN"),
  fileUploader.categoryAssets,
  parseBodyData,
  validateRequest(CategoryValidation.createCategory),
  CategoryController.createCategory,
);

route.patch(
  "/update/:id",
  auth("SUPERADMIN", "ADMIN"),
  fileUploader.categoryAssets,
  parseBodyData,
  validateRequest(CategoryValidation.updateCategory),
  CategoryController.updateCategory,
);

route.delete(
  "/delete/:id",
  auth("SUPERADMIN", "ADMIN"),
  CategoryController.deleteCategory,
);

// Keep the slug route last so it never shadows the static paths above
route.get("/:slug", CategoryController.categoryBySlug);

export const CategoryRoutes = route;
