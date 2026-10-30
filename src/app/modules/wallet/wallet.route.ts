import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { WalletController } from "./wallet.controller";
import { WalletValidation } from "./wallet.validation";
const route = Router();

// ─── Admin ───────────────────────────────────────────────────────────────────
route.get(
  "/admin/withdrawals",
  auth("SUPERADMIN", "ADMIN"),
  WalletController.allWithdrawalsForAdmin,
);

route.patch(
  "/admin/withdrawals/:id",
  auth("SUPERADMIN", "ADMIN"),
  validateRequest(WalletValidation.updateWithdrawalStatus),
  WalletController.updateWithdrawalStatus,
);

route.post(
  "/admin/adjust",
  auth("SUPERADMIN", "ADMIN"),
  validateRequest(WalletValidation.adminAdjustWallet),
  WalletController.adminAdjustWallet,
);

// ─── Owner ───────────────────────────────────────────────────────────────────
route.get("/", auth(), WalletController.myWallet);

route.get("/transactions", auth(), WalletController.myTransactions);

route.get("/withdrawals", auth(), WalletController.myWithdrawals);

route.post(
  "/withdrawals",
  auth("VENDOR", "SUPERADMIN", "ADMIN"),
  validateRequest(WalletValidation.requestWithdrawal),
  WalletController.requestWithdrawal,
);

export const WalletRoutes = route;
