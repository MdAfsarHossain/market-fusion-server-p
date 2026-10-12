import { Router } from "express";
import { AdminController } from "./admin.controller";
import auth from "../../middlewares/auth";
const route = Router();

route.get(
  "/kyc",
  auth("SUPERADMIN", "ADMIN"),
  AdminController.getAllKYCDocuments,
);


export const AdminRoutes = route;
