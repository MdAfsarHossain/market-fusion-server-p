import { NextFunction, Request, Response } from "express";
import { JwtPayload, Secret } from "jsonwebtoken";
import config from "../../config";
import httpStatus from "http-status";
import { jwtHelpers } from "../helpers/jwtHelpers";
import ApiError from "../errors/ApiError";
import { query } from "../utils/db";
import { assertDemoReadOnly } from "../utils/demoGuard";

const auth = (...roles: string[]) => {
  return async (
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      // Check authorization header
      const headersAuth = req.headers.authorization;
      if (!headersAuth || !headersAuth.startsWith("Bearer ")) {
        throw new ApiError(
          httpStatus.UNAUTHORIZED,
          "Invalid authorization format!",
        );
      }

      const token: string | undefined = headersAuth.split(" ")[1];
      if (!token) {
        throw new ApiError(httpStatus.UNAUTHORIZED, "You are not authorized!");
      }

      // Verify token
      const verifiedUser = jwtHelpers.verifyToken(
        token,
        config.jwt.access_secret as Secret,
      );

      if (!verifiedUser?.email || !verifiedUser?.id) {
        throw new ApiError(httpStatus.UNAUTHORIZED, "You are not authorized!");
      }

      const { id } = verifiedUser;

      // Get user from database
      const userResult = await query(
        `
                SELECT 
                    id, 
                    email, 
                    name, 
                    role, 
                    status, 
                    is_active,
                    is_email_verified,
                    is_verified,
                    is_demo,
                    "createdAt" as "createdAt"
                FROM users 
                WHERE id = $1::uuid
            `,
        [id],
      );

      if (userResult.rows.length === 0) {
        throw new ApiError(httpStatus.NOT_FOUND, "User not found!");
      }

      const user = userResult.rows[0];

      // Check user status
      if (user.status === "BLOCKED") {
        throw new ApiError(httpStatus.FORBIDDEN, "Your account is blocked!");
      }

      if (user.status === "INACTIVE") {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          "Your account is not activated yet!",
        );
      }

      if (user.status === "PENDING") {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          "Your account is not accepted yet!",
        );
      }

      if (!user.is_active) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          "Your account is deactivated!",
        );
      }

      // Attach user to request
      req.user = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        status: user.status,
        is_demo: user.is_demo === true,
        ...verifiedUser,
      };

      // Demo accounts are read-only. Enforced here so every authenticated
      // route inherits it, rather than trusting each one to check.
      assertDemoReadOnly(user.is_demo === true, req.method, req.originalUrl);

      // Check role authorization
      if (roles.length && !roles.includes(user.role)) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          "Forbidden! You are not authorized to access this resource!",
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

// OTP Check Middleware (for password reset)
export const checkOTP = async (
  req: Request & { user?: any },
  res: Response,
  next: NextFunction,
) => {
  try {
    const headersAuth = req.headers.authorization;
    if (!headersAuth || !headersAuth.startsWith("Bearer ")) {
      throw new ApiError(
        httpStatus.UNAUTHORIZED,
        "Invalid authorization format!",
      );
    }

    const token: string | undefined = headersAuth.split(" ")[1];
    if (!token) {
      throw new ApiError(httpStatus.UNAUTHORIZED, "You are not authorized!");
    }

    // Verify with reset password secret
    const verifiedUser = jwtHelpers.verifyToken(
      token,
      config.jwt.reset_pass_secret as Secret,
    );
    if (!verifiedUser?.id) {
      throw new ApiError(httpStatus.UNAUTHORIZED, "You are not authorized!");
    }

    const { id } = verifiedUser;

    // Get user from database
    const userResult = await query(
      `
            SELECT id, email, name, role, status, is_active
            FROM users 
            WHERE id = $1::uuid
        `,
      [id],
    );

    if (userResult.rows.length === 0) {
      throw new ApiError(httpStatus.NOT_FOUND, "User not found!");
    }

    const user = userResult.rows[0];

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      ...verifiedUser,
    };

    next();
  } catch (err) {
    next(err);
  }
};

export const optionalAuth = (...roles: string[]) => {
  return async (
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const headersAuth = req.headers.authorization;
      const token: string | undefined = headersAuth?.split(" ")[1];

      if (!token) {
        // No token provided, proceed without authentication
        return next();
      }

      const verifiedUser = jwtHelpers.verifyToken(
        token,
        config.jwt.access_secret as Secret,
      );

      if (!verifiedUser?.email) {
        throw new ApiError(httpStatus.UNAUTHORIZED, "You are not authorized!");
      }
      const { id } = verifiedUser;

      // const user = await prisma.user.findUnique({
      //   where: { id },
      // });

      // if (!user) {
      //   throw new ApiError(httpStatus.NOT_FOUND, 'User not found!');
      // }

      // if (user.status === UserStatus.BLOCKED) {
      //   throw new ApiError(httpStatus.FORBIDDEN, 'Your account is blocked!');
      // }

      req.user = verifiedUser as JwtPayload;

      if (roles.length && !roles.includes(verifiedUser.role)) {
        throw new ApiError(httpStatus.FORBIDDEN, "Forbidden!");
      }

      next();
    } catch (err) {
      next(err);
    }
  };
};

export default auth;
