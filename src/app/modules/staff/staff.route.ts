import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { StaffController } from "./staff.controller";
import { StaffValidation } from "./staff.validation";
const route = Router();

// ─── Invitee ─────────────────────────────────────────────────────────────────
// Any signed in account can be invited, so these are not vendor gated
route.get("/my-invites", auth(), StaffController.myInvites);

route.post("/accept/:id", auth(), StaffController.acceptInvite);

route.post("/decline/:id", auth(), StaffController.declineInvite);

// ─── Store side ──────────────────────────────────────────────────────────────
route.get("/my-access", auth("VENDOR", "SUPERADMIN", "ADMIN"), StaffController.myAccess);

route.get("/", auth("VENDOR"), StaffController.allStaff);

route.post(
  "/invite",
  auth("VENDOR"),
  validateRequest(StaffValidation.inviteStaff),
  StaffController.inviteStaff,
);

route.patch(
  "/update/:id",
  auth("VENDOR"),
  validateRequest(StaffValidation.updateStaff),
  StaffController.updateStaff,
);

route.delete("/revoke/:id", auth("VENDOR"), StaffController.revokeStaff);

export const StaffRoutes = route;
