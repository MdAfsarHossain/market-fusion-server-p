import httpStatus from "http-status";
import sendResponse from "../../helpers/sendResponse";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import { AuthServices } from "./auth.service";

const createAccount = catchAsync(async (req, res) => {
  // const host = req.header('host') || '';
  const files = req.files;

  const result: any = await AuthServices.createAccount(req.body, files as any);

  if (result.statusCode) {
    const { statusCode, message, ...data } = result;
    return sendResponse(res, {
      statusCode,
      message,
      data: data,
    });
  }

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.CREATED,
    message: "Account created successfully",
    data: result,
  });
});

const verifiedEmail = catchAsync(async (req, res) => {
  const { userId, otpCode, type } = req.body;

  // const result: any = await AuthServices.verifyEmail(userId, { otpCode, type });
  // if (result.statusCode) {
  //   const { statusCode, message, ...data } = result
  //   return sendResponse(res, {
  //     statusCode,
  //     message,
  //     data: data,
  //   });
  // }

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "OTP verified successfully",
    data: [],
  });
});

const loginUser = catchAsync(async (req: Request, res: Response) => {
  const { email, password, fcm_token } = req.body;

  const result = await AuthServices.loginUserFromDB(email, password, fcm_token);

  // if (result.statusCode) {
  //   const { statusCode, message, success, ...data } = result
  //   return sendResponse(res, {
  //     success: false,
  //     statusCode,
  //     message,
  //     data: data.data,
  //   });
  // }

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Login successful",
    data: result,
  });
});

const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.forgotPassword(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP sent successfully",
    data: result,
  });
});

const verifyResetPasswordOtp = catchAsync(async (req, res) => {
  const { userId, otpCode } = req.body;

  const result: any = await AuthServices.verifyResetPasswordOtp(
    userId,
    otpCode,
  );

  // if (result.statusCode) {
  //   const { statusCode, message, ...data } = result
  //   return sendResponse(res, {
  //     statusCode,
  //     message,
  //     data: data,
  //   });
  // }
  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "OTP verified successfully",
    data: result,
  });
});

// const verifyOtp = catchAsync(async (req, res) => {
//   const result: any = await AuthServices.verifyOtp(req.body);
//   console.log(result.statusCode);
//   if (result.statusCode) {
//     const { statusCode, message, ...data } = result
//     return sendResponse(res, {
//       statusCode,
//       message,
//       data: data,
//     });
//   }

//   sendResponse(res, {
//     statusCode: httpStatus.OK,
//     message: 'OTP verified successfully please reset your password',
//     data: result,
//   });
// });

const resetPassword = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const newPassword = req.body.newPassword;
  const result = await AuthServices.resetPassword(userId, newPassword);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Password Reset successfully please login",
    data: result,
  });
});

const changePassword = catchAsync(async (req, res) => {
  const userId: string = req.user.id;
  const oldPassword: string = req.body.oldPassword;
  const newPassword: string = req.body.newPassword;
  const result = await AuthServices.changePassword(userId, {
    newPassword,
    oldPassword,
  });

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "Password changed successfully! ",
    data: result,
  });
});

const resendOtp = catchAsync(async (req, res) => {
  const { userId } = req.body;

  const result: any = await AuthServices.resendOtp(userId);

  // if (result.statusCode) {
  //   const { statusCode, message, ...data } = result
  //   return sendResponse(res, {
  //     statusCode,
  //     message,
  //     data: data,
  //   });
  // }
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "OTP Resend successfully",
    data: result,
  });
});

export const AuthControllers = {
  createAccount,
  loginUser,
  forgotPassword,
  resetPassword,
  changePassword,
  verifiedEmail,
  resendOtp,
  verifyResetPasswordOtp,
};
