import * as bcrypt from "bcrypt";
import httpStatus from "http-status";
import { query } from "../../utils/db";
import config from "../../../config";
import { jwtHelpers } from "../../helpers/jwtHelpers";
import { Secret } from "jsonwebtoken";
import ApiError from "../../errors/ApiError";
import { S3Uploader } from "../../lib/S3Uploader";
import { OTPFn } from "./OTPFn";
import { forgotEmailTemplate } from "../../utils/emailNotifications/forgotHTML";

// src/app/modules/auth/auth.service.ts - Raw SQL version

// Create New Account
const createAccount = async (
  payload: {
    name: string;
    email: string;
    password: string;
    phone_number: string;
    address: string;
    date_of_birth: string;
    role: string;
    fcm_token?: string;
    business_name?: string;
    description?: string;
    offerings?: string[];
    kvk_number?: string;
  },
  files?: any,
) => {
  // const client = await pool.connect();

  // try {
  // await client.query('BEGIN');

  // 1. Check if user already exists
  const existingUserResult = await query(
    `
      SELECT id FROM users WHERE email = $1
    `,
    [payload.email],
  );

  if (existingUserResult.rows.length > 0) {
    throw new ApiError(httpStatus.CONFLICT, "This email is already registered");
  }

  // 2. Hash password
  const hashedPassword = await bcrypt.hash(payload.password, 12);

  // 3. Initialize file URLs
  let kvk_or_eu_vat = undefined;
  let license_or_utility_bill = undefined;
  let id_legal_representative = undefined;

  // 5. Insert user
  const userResult = await query(
    `
      INSERT INTO users (
        name,
        email,
        password,
        phone_number,
        address,
        date_of_birth,
        role,
        status,
        is_email_verified,
        is_verified,
        fcm_token,
        is_business_account,
        "createdAt",
        "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::"Role", $8::"UserStatus", 
        $9, $10, $11, $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING 
        id, 
        name, 
        email, 
        role, 
        status, 
        phone_number, 
        address, 
        date_of_birth
    `,
    [
      payload.name,
      payload.email.trim(),
      hashedPassword,
      payload.phone_number,
      payload.address,
      payload.date_of_birth,
      payload.role || "USER",
      "ACTIVE",
      true, // is_email_verified
      true, // is_verified
      payload.fcm_token || null,
      payload.role === "BUSINESS",
    ],
  );

  const user = userResult.rows[0];
  
  // 9. Generate tokens
  const accessToken = jwtHelpers.generateToken(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    config.jwt.access_secret as Secret,
    config.jwt.access_expires_in as string,
  );

  const refreshToken = jwtHelpers.generateToken(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    config.jwt.refresh_secret as Secret,
    config.jwt.refresh_expires_in as string,
  );

  // await query('COMMIT');

  // 10. Return result
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    email: user.email,
    status: user.status,
    phone_number: user.phone_number,
    address: user.address,
    date_of_birth: user.date_of_birth,
    accessToken,
    refreshToken,
  };

  // } catch (error) {
  //     await query('ROLLBACK');
  //     console.error('Error creating account:', error);
  //     throw error;
  // }
};

// Login User
const loginUserFromDB = async (
  email: string,
  password: string,
  fcm_token?: string,
) => {
  // console.log(email);

  // Get user with password
  const result: any = await query("SELECT * FROM users WHERE email = $1", [
    email,
  ]);
  // console.log(result.rows[0]);

  const user = result.rows[0];

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  const isCorrectPassword = await bcrypt.compare(password, user.password);

  if (!isCorrectPassword) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid password");
  }

  //    // Skip check for admin users
  const isAdminOrUser =
    user.role === "ADMIN" || user.role === "SUPERADMIN" || user.role === "USER";

  const accessToken = jwtHelpers.generateToken(
    {
      id: user.id,
      email: user.email as string,
      role: user.role,
    },
    config.jwt.access_secret as Secret,
    config.jwt.access_expires_in as string,
  );

  const refreshToken = jwtHelpers.generateToken(
    {
      id: user.id,
      email: user.email as string,
      role: user.role,
    },
    config.jwt.refresh_secret as Secret,
    config.jwt.refresh_expires_in as string,
  );

  if (isAdminOrUser) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone_number: user.phone_number,
      address: user.address,
      date_of_birth: user.date_of_birth,
      role: user.role,
      avatar: user.avatar,
      status: user.status,
      accessToken: accessToken,
      refreshToken: refreshToken,
    };
  }

  // Check subscription
  // if (user.plan_type !== "PREMIUM") {
  //     return {
  //         success: false,
  //         statusCode: httpStatus.PERMANENT_REDIRECT,
  //         message: "Please first upgrade your subscription to premium",
  //         data: {
  //             type: "SubscriptionPage",
  //             requiredField: "premium subscription",
  //             missingFields: ["premium subscription"],
  //             accessToken: accessToken,
  //             refreshToken: refreshToken,
  //         },
  //     };
  // }

  if (fcm_token) {
    await query(
      `
      UPDATE users
    SET fcm_token = $1
    WHERE id = $2
    `,
      [fcm_token, user.id],
    );
  }
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone_number: user.phone_number,
    address: user.address,
    date_of_birth: user.date_of_birth,
    role: user.role,
    avatar: user.avatar,
    status: user.status,
    accessToken: accessToken,
    refreshToken: refreshToken,
  };
};

// Helper function to generate OTP
const generateOTP = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Forgot Password
const forgotPassword = async (payload: { email: string }) => {
  // Check if user exists
  const userResult = await query(
    `
        SELECT id, name, email FROM users WHERE email = $1
    `,
    [payload.email],
  );

  if (userResult.rows.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "User not found");
  }

  const user = userResult.rows[0];

  // Generate OTP
  const otpCode = generateOTP();
  const expiry = new Date();
  expiry.setMinutes(expiry.getMinutes() + 10);

  // Delete old OTPs
  // await query(`
  //     DELETE FROM otps WHERE user_id = $1::uuid
  // `, [user.id]);

  // // Insert new OTP
  // await query(`
  //     INSERT INTO otps (user_id, otp_code, expiry, created_at)
  //     VALUES ($1::uuid, $2, $3, CURRENT_TIMESTAMP)
  // `, [user.id, otpCode, expiry]);

  // Send OTP email
  // await sendOTPEmail(user.email, otpCode, "Forgot Password OTP email");

  OTPFn(user.email, user.id, "Forgot Password OTP email", forgotEmailTemplate);

  return {
    id: user.id,
    name: user.name,
    otpSent: true,
    message:
      "An OTP has been sent to your email address. Please check your email.",
    type: "forgotPassword",
  };
};

// Reset Password
const resetPassword = async (userId: string, newPassword: string) => {
  const hashedPassword = await bcrypt.hash(
    newPassword,
    Number(config.bcrypt_salt_rounds) || 12,
  );

  await query(
    `
        UPDATE users 
        SET 
            password = $1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $2::uuid
    `,
    [hashedPassword, userId],
  );

  return {
    message: "Please login with your new password",
  };
};

// Change Password
const changePassword = async (
  userId: string,
  payload: { oldPassword: string; newPassword: string },
) => {
  // Get user with password
  const userResult = await query(
    `
        SELECT id, email, password, status
        FROM users
        WHERE id = $1::uuid
    `,
    [userId],
  );

  if (userResult.rows.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "User not found! If you have already have account please reset your password",
    );
  }

  const user = userResult.rows[0];

  // Check if user is blocked
  if (user.status === "BLOCKED") {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "Your account has been blocked. Please contact support.",
    );
  }

  // Verify old password
  const isCorrectPassword = await bcrypt.compare(
    payload.oldPassword,
    user.password,
  );
  if (!isCorrectPassword) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Credentials not matched");
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(
    payload.newPassword,
    Number(config.bcrypt_salt_rounds) || 12,
  );

  // Update password
  await query(
    `
        UPDATE users 
        SET 
            password = $1,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $2::uuid
    `,
    [hashedPassword, userId],
  );

  return {
    message: "Password updated successfully",
  };
};

// Verify Reset Password OTP
const verifyResetPasswordOtp = async (userId: string, otpCode: string) => {
  // const client = await pool.connect();

  // try {
  // await client.query('BEGIN');

  // Get OTP record
  const otpResult = await query(
    `
            SELECT id, expiry, otp_code
            FROM otp
            WHERE user_id = $1::uuid AND otp_code = $2
        `,
    [userId, otpCode],
  );

  if (otpResult.rows.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid OTP or expired OTP");
  }

  const otpRecord = otpResult.rows[0];

  // Check if OTP expired
  if (new Date(otpRecord.expiry) < new Date()) {
    await query(
      `
                DELETE FROM otp WHERE id = $1::uuid
            `,
      [otpRecord.id],
    );
    throw new ApiError(httpStatus.REQUEST_TIMEOUT, "OTP expired");
  }

  // Delete all OTP records for this user
  await query(
    `
            DELETE FROM otp WHERE user_id = $1::uuid
        `,
    [userId],
  );

  // await client.query('COMMIT');

  // Generate access token
  const accessToken = jwtHelpers.generateToken(
    { id: userId },
    config.jwt.reset_pass_secret as Secret,
    config.jwt.reset_pass_token_expires_in as string,
  );

  return {
    message: "OTP verified successfully",
    userId,
    accessToken,
  };

  // } catch (error) {
  //     await query('ROLLBACK');
  //     throw error;
  // } finally {
  //     release();
  // }
};

// Resend OTP - Raw SQL Version
const resendOtp = async (userId: string) => {
  // Get user from database
  const userResult = await query(
    `
        SELECT id, name, email 
        FROM users 
        WHERE id = $1::uuid
    `,
    [userId],
  );

  if (userResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "User Not found");
  }

  const existingUser = userResult.rows[0];

  // Send OTP
  await OTPFn(
    existingUser.email,
    existingUser.id,
    "OTP Resend for Email Verification",
    forgotEmailTemplate,
  );

  return {
    id: existingUser.id,
    name: existingUser.name,
    email: existingUser.email,
    type: "resendOtp",
    message: "OTP Resend successfully to your email",
    otpSent: true,
  };
};

export const AuthServices = {
  createAccount,
  loginUserFromDB,
  forgotPassword,
  verifyResetPasswordOtp,
  resetPassword,
  changePassword,
  resendOtp,
};
