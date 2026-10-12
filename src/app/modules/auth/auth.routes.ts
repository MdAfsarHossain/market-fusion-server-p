import express from "express";
import validateRequest from "../../middlewares/validateRequest";
import { authValidation } from "./auth.validation";
import { AuthControllers } from "./auth.controller";
import auth, { checkOTP } from "../../middlewares/auth";
import parseBodyData from "../../middlewares/parseBodyData";
import { fileUploader } from "../../middlewares/multerFileUpload";

const router = express.Router();

router.post(
  "/register",
  //fileUploader.fields([{ name: 'kvk_or_eu_vat', maxCount: 1 }, { name: 'license_or_utility_bill', maxCount: 1 }, { name: 'id_legal_representative', maxCount: 1 }]),
  fileUploader.businessDocUpload,
  parseBodyData,
  validateRequest(authValidation.registerUser),
  AuthControllers.createAccount,
);

router.post(
  "/email-verify",
  validateRequest(authValidation.verifyOtp),
  AuthControllers.verifiedEmail,
);

router.post(
  "/resend-otp",
  validateRequest(authValidation.resendOtp),
  // checkOTP,
  AuthControllers.resendOtp,
);

router.post(
  "/login",
  validateRequest(authValidation.loginUser),
  AuthControllers.loginUser,
);

router.post(
  "/forgot-password",
  validateRequest(authValidation.forgotPassword),
  AuthControllers.forgotPassword,
);

router.post(
  "/verify-reset-password-otp",
  validateRequest(authValidation.verifyOtp),
  AuthControllers.verifyResetPasswordOtp,
);

router.post(
  "/reset-password",
  validateRequest(authValidation.resetPassword),
  checkOTP,
  AuthControllers.resetPassword,
);

router.post(
  "/change-password",
  validateRequest(authValidation.changePassword),
  auth(),
  AuthControllers.changePassword,
);

export const AuthRouters = router;
