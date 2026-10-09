// import { Role, UserStatus } from '@prisma/client';
import * as bcrypt from "bcrypt";
import config from "../../config";
import { pool } from "../../config/database";

const superAdminData = {
  name: "Super Admin",
  email: "admin@gmail.com",
  password: "12345678",
  role: "SUPERADMIN",
  status: "ACTIVE",
  is_email_verified: true,
};

const seedSuperAdmin = async () => {
  // console.log(`Super Admin data:`);
  // console.log(superAdminData);

  const client = await pool.connect();
  try {
    // Check if super admin exists
    const isSuperAdminExists = await client.query(
      `
      SELECT EXISTS (
        SELECT 1 FROM users 
        WHERE role = $1::"Role"
      ) as exists
    `,
      ["SUPERADMIN"],
    );

    const superAdminExists = isSuperAdminExists.rows[0].exists;

    // If not, create one
    if (!superAdminExists) {
      const hashedPassword = await bcrypt.hash(
        config.super_admin_password as string,
        Number(config.bcrypt_salt_rounds) || 12,
      );

      // Insert super admin
      await client.query(
        `
        INSERT INTO users (
          name,
          email,
          password,
          role,
          status,
          is_email_verified,
          is_verified,
          is_active,
          "createdAt",
          "updatedAt"
        ) VALUES (
          $1, $2, $3, $4::"Role", $5::"UserStatus", $6, $7, $8, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `,
        [
          "Super Admin",
          "admin@gmail.com",
          hashedPassword,
          "SUPERADMIN",
          "ACTIVE",
          true,
          true,
          true,
        ],
      );
      console.log("Super Admin created successfully.");
    } else {
      return;
      //   console.log("Super Admin already exists.");
    }
  } catch (error) {
    console.error("Error seeding Super Admin:", error);
  }
};

export default seedSuperAdmin;
