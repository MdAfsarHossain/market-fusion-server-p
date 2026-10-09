// middlewares/checkProfileCompletion.ts
import { Request, Response, NextFunction } from "express";
import httpStatus from "http-status";
import { jwtHelpers } from "../helpers/jwtHelpers";
import config from "../../config";
import { Secret } from "jsonwebtoken";
import { query } from "../utils/db";

// THIS IS Version V1. And This Works properly
// export const checkBusinessSubscription = async (
//   req: Request & { user?: any },
//   res: Response,
//   next: NextFunction
// ) => {
//   console.log("Checking business subscription");

//   try {
//     const userId = req.user?.id;
//     // console.log(req.user);

//     if (!userId) {
//       return res.status(httpStatus.UNAUTHORIZED).json({
//         success: false,
//         message: "User not authenticated",
//       });
//     }

//     // Get user from database
//     // const user = await prisma.user.findUnique({
//     //   where: { id: userId },
//     //   select: {
//     //     id: true,
//     //     name: true,
//     //     email: true,
//     //     plan_type: true,
//     //     role: true,
//     //   },
//     // });

//     // if (!user) {
//     //   return res.status(httpStatus.NOT_FOUND).json({
//     //     success: false,
//     //     message: "User not found",
//     //   });
//     // }

//     // Skip check for admin users
//     // const isAuthorizedUser = user.role === Role.ADMIN || user.role === Role.SUPERADMIN || user.role === Role.USER;
//     // if (isAuthorizedUser) {
//     //   return next();
//     // }

//     // const accessToken = jwtHelpers.generateToken(
//     //     {
//     //       id: user.id,
//     //       email: user.email as string,
//     //       role: user.role,
//     //     },
//     //     config.jwt.access_secret as Secret,
//     //     config.jwt.access_expires_in as string
//     //   );

//     //   const refreshToken = jwtHelpers.generateToken(
//     //     {
//     //       id: user.id,
//     //       email: user.email as string,
//     //       role: user.role,
//     //     },
//     //     config.jwt.refresh_secret as Secret,
//     //     config.jwt.refresh_expires_in as string
//     //   );

//     // Check subscription
//     // if (user.plan_type !== PlanType.PREMIUM) {
//     //   return res.status(httpStatus.PERMANENT_REDIRECT).json({
//     //     success: false,
//     //     message: "Please first upgrade your subscription to premium",
//     //     data: {
//     //       type: "SubscriptionPage",
//     //       requiredField: "premium subscription",
//     //       missingFields: ["premium subscription"],
//     //       accessToken,
//     //       refreshToken,
//     //     },
//     //   });
//     // }
//     // console.log(user);

//     // If all checks pass, proceed to next middleware/controller
//     next();
//   } catch (error) {
//     next(error);
//   }
// };

export const checkBusinessSubscription = async (
  req: Request & { user?: any },
  res: Response,
  next: NextFunction,
) => {
  console.log("Checking business subscription");

  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(httpStatus.UNAUTHORIZED).json({
        success: false,
        message: "User not authenticated",
      });
    }

    // Get user from database
    const userResult = await query(
      `
            SELECT 
                id, 
                name, 
                email, 
                plan_type, 
                role,
                status,
                is_active
            FROM users 
            WHERE id = $1::uuid
        `,
      [userId],
    );

    if (userResult.rows.length === 0) {
      return res.status(httpStatus.NOT_FOUND).json({
        success: false,
        message: "User not found",
      });
    }

    const user = userResult.rows[0];

    // Check if user is blocked or inactive
    if (user.status === "BLOCKED") {
      return res.status(httpStatus.FORBIDDEN).json({
        success: false,
        message: "Your account is blocked. Please contact support.",
      });
    }

    if (!user.is_active) {
      return res.status(httpStatus.FORBIDDEN).json({
        success: false,
        message: "Your account is deactivated. Please contact support.",
      });
    }

    // Skip check for admin and regular users (non-business roles)
    const isAuthorizedUser =
      user.role === "ADMIN" ||
      user.role === "SUPERADMIN" ||
      user.role === "USER";
    if (isAuthorizedUser) {
      return next();
    }

    // Generate new tokens
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

    // Check subscription for business users
    if (user.plan_type !== "PREMIUM") {
      // Check if user has an active subscription in user_subscriptions table
      const activeSubscriptionResult = await query(
        `
                SELECT 
                    id, 
                    status, 
                    plan_id,
                    next_payment_date
                FROM user_subscriptions 
                WHERE user_id = $1::uuid 
                    AND status = 'ACTIVE'
                    AND (next_payment_date IS NULL OR next_payment_date > CURRENT_TIMESTAMP)
                LIMIT 1
            `,
        [userId],
      );

      const hasActiveSubscription = activeSubscriptionResult.rows.length > 0;

      // If user has active subscription but plan_type is not updated, update it
      if (hasActiveSubscription && user.plan_type !== "PREMIUM") {
        await query(
          `
                    UPDATE users 
                    SET plan_type = 'PREMIUM'::"PlanType"
                    WHERE id = $1::uuid
                `,
          [userId],
        );

        // Continue as they now have premium
        return next();
      }

      return res.status(httpStatus.PAYMENT_REQUIRED).json({
        success: false,
        message: "Please first upgrade your subscription to premium",
        data: {
          type: "SubscriptionPage",
          requiredField: "premium subscription",
          missingFields: ["premium subscription"],
          accessToken,
          refreshToken,
        },
      });
    }

    // Also verify that the premium status is backed by an active subscription
    if (user.plan_type === "PREMIUM") {
      const activeSubscriptionResult = await query(
        `
                SELECT id, status, next_payment_date
                FROM user_subscriptions 
                WHERE user_id = $1::uuid 
                    AND status = 'ACTIVE'
                    AND (next_payment_date IS NULL OR next_payment_date > CURRENT_TIMESTAMP)
                LIMIT 1
            `,
        [userId],
      );

      // If no active subscription found but user has PREMIUM plan type, downgrade them
      if (activeSubscriptionResult.rows.length === 0) {
        await query(
          `
                    UPDATE users 
                    SET plan_type = 'FREE'::"PlanType"
                    WHERE id = $1::uuid
                `,
          [userId],
        );

        return res.status(httpStatus.PAYMENT_REQUIRED).json({
          success: false,
          message:
            "Your premium subscription has expired. Please renew to continue.",
          data: {
            type: "SubscriptionPage",
            requiredField: "premium subscription",
            missingFields: ["premium subscription"],
            accessToken,
            refreshToken,
          },
        });
      }
    }

    // If all checks pass, proceed to next middleware/controller
    next();
  } catch (error) {
    console.error("Error in checkBusinessSubscription:", error);
    next(error);
  }
};
