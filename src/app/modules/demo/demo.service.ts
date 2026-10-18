import httpStatus from "http-status";
import { Secret } from "jsonwebtoken";
import config from "../../../config";
import ApiError from "../../errors/ApiError";
import { jwtHelpers } from "../../helpers/jwtHelpers";
import { query } from "../../utils/db";

// What a visitor asks for, and the role that actually backs it. Buyers are
// plain users; the vendor account owns the demo store; the admin account sees
// the platform panel. One account cannot cover all three because role is a
// single column, so the login page offers a choice.
const DEMO_ROLES = {
  BUYER: "USER",
  VENDOR: "VENDOR",
  ADMIN: "ADMIN",
} as const;

export type DemoRole = keyof typeof DEMO_ROLES;

// Hands out a token for a seeded, read-only account without a password.
//
// Safe to leave unauthenticated because it can only ever return an account
// flagged is_demo, and auth() refuses every write for those. If the seed has
// not been run there is simply nothing to hand out.
const demoLogin = async (requested: DemoRole) => {
  const role = DEMO_ROLES[requested];

  if (!role) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Unknown demo role.");
  }

  const result = await query(
    `
        SELECT id, name, email, phone_number, address, date_of_birth,
               role, avatar, status, is_demo
        FROM users
        WHERE is_demo = true
            AND role = $1::"Role"
            AND is_active = true
        ORDER BY "createdAt"
        LIMIT 1
    `,
    [role],
  );

  if (result.rows.length === 0) {
    throw new ApiError(
      httpStatus.NOT_FOUND,
      "The demo accounts have not been set up on this server yet.",
    );
  }

  const user = result.rows[0];

  const payload = { id: user.id, email: user.email, role: user.role };

  const accessToken = jwtHelpers.generateToken(
    payload,
    config.jwt.access_secret as Secret,
    config.jwt.access_expires_in as string,
  );

  const refreshToken = jwtHelpers.generateToken(
    payload,
    config.jwt.refresh_secret as Secret,
    config.jwt.refresh_expires_in as string,
  );

  return { ...user, accessToken, refreshToken };
};

export const DemoService = { demoLogin };
