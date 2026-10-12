import { Router } from "express";
import auth from "../../middlewares/auth";
import { AnalyticsController } from "./analytics.controller";
const route = Router();

// ─── Admin ───────────────────────────────────────────────────────────────────
route.get(
  "/admin/overview",
  auth("SUPERADMIN", "ADMIN"),
  AnalyticsController.adminOverview,
);

route.get(
  "/admin/revenue",
  auth("SUPERADMIN", "ADMIN"),
  AnalyticsController.adminRevenueSeries,
);

route.get(
  "/admin/top-stores",
  auth("SUPERADMIN", "ADMIN"),
  AnalyticsController.adminTopStores,
);

route.get(
  "/admin/sales-by-type",
  auth("SUPERADMIN", "ADMIN"),
  AnalyticsController.adminSalesByType,
);

// ─── Vendor ──────────────────────────────────────────────────────────────────
route.get("/vendor/overview", auth("VENDOR"), AnalyticsController.vendorOverview);

route.get(
  "/vendor/revenue",
  auth("VENDOR"),
  AnalyticsController.vendorRevenueSeries,
);

route.get(
  "/vendor/top-products",
  auth("VENDOR"),
  AnalyticsController.vendorTopProducts,
);

route.get(
  "/vendor/sales-by-type",
  auth("VENDOR"),
  AnalyticsController.vendorSalesByType,
);

export const AnalyticsRoutes = route;
