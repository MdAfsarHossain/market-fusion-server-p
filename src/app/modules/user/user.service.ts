import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { S3Uploader } from "../../lib/S3Uploader";
import { query } from "../../utils/db";

// My Profile - Get user profile with business and KYC information
const myProfile = async (userId: string) => {
  // Get user with business and KYC information
  const result = await query(
    `
        SELECT 
            u.id,
            u.name,
            u.phone_number,
            u.email,
            u.address,
            u.avatar,
            u.date_of_birth,
            u.kyc_verification_status,
            u.role,
            u.status,
            u.is_active,
            u.is_email_verified,
            u.is_verified,
            u."createdAt" as "createdAt",
            u."updatedAt" as "updatedAt",
            json_build_object(
                'id', b.id,
                'name', b.name,
                'description', b.description,
                'address', b.address,
                'phone', b.phone,
                'email', b.email,
                'website', b.website,
                'custom_fields', b.custom_fields,
                'kvk_number', b.kvk_number,
                'id_legal_representative', b.id_legal_representative,
                'license_or_utility_bill', b.license_or_utility_bill,
                'kvk_or_eu_vat', b.kvk_or_eu_vat,
                'business_document_status', b.business_document_status,
                'createdAt', b."createdAt",
                'updatedAt', b."updatedAt"
            ) as business,
            json_build_object(
                'id', k.id,
                'government_id_front_part', k.government_id_front_part,
                'government_id_back_part', k.government_id_back_part,
                'government_id_verification_video', k.government_id_verification_video,
                'createdAt', k."createdAt",
                'updatedAt', k."updatedAt"
            ) as kyc_document
        FROM users u
        LEFT JOIN businesses b ON u.id = b.creator_id
        LEFT JOIN kyc_documents k ON u.id = k.user_id
        WHERE u.id = $1::uuid
    `,
    [userId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "This user is not registered.");
  }

  const userData = result.rows[0];

  // Parse custom_fields if it's JSONB
  if (
    userData.business &&
    userData.business.custom_fields &&
    typeof userData.business.custom_fields === "string"
  ) {
    try {
      userData.business.custom_fields = JSON.parse(
        userData.business.custom_fields,
      );
    } catch (error) {
      userData.business.custom_fields = {};
    }
  }

  // If no business exists, set businessData to null
  if (!userData.business || !userData.business.id) {
    userData.business = null;
  }

  // If no KYC document exists, set kycData to null
  if (!userData.kyc_document || !userData.kyc_document.id) {
    userData.kyc_document = null;
  }

  const { business, kyc_document, ...rest } = userData;

  return {
    ...rest,
    businessData: business,
    kycData: kyc_document,
  };
};

// Get All Users (excluding current user, only BUSINESS and USER roles)
const allUsers = async (userId: string, pagination: any) => {
  const { page = 1, limit = 10 } = pagination;
  const pageNum = parseInt(page as string, 10);
  const limitNum = parseInt(limit as string, 10);
  const offset = (pageNum - 1) * limitNum;

  // Get users with pagination
  const usersResult = await query(
    `
        SELECT 
            u.id,
            u.name,
            u.avatar,
            u.email,
            u.role,
            u.status,
            u.is_active,
            u."createdAt" as "createdAt"
        FROM users u
        WHERE u.id != $1::uuid
            AND u.role IN ('BUSINESS'::"Role", 'USER'::"Role")
        ORDER BY u."createdAt" DESC
        LIMIT $2 OFFSET $3
    `,
    [userId, limitNum, offset],
  );

  // Get total count
  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM users u
        WHERE u.id != $1::uuid
            AND u.role IN ('BUSINESS'::"Role", 'USER'::"Role")
    `,
    [userId],
  );

  const totalUsers = parseInt(countResult.rows[0].total);
  const totalPage = Math.ceil(totalUsers / limitNum);

  return {
    meta: {
      page: pageNum,
      limit: limitNum,
      total: totalUsers,
      totalPage: totalPage,
      hasNextPage: pageNum < totalPage,
      hasPrevPage: pageNum > 1,
    },
    data: usersResult.rows,
  };
};

// Update User Profile
const updateUser = async (userId: string, payload: any, file?: any) => {
  // Check if user exists
  const userResult = await query(
    `
        SELECT id, avatar FROM users WHERE id = $1::uuid
    `,
    [userId],
  );

  if (userResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "This user is not registered.");
  }

  const existingUser = userResult.rows[0];
  let avatar = existingUser.avatar;

  // Upload new avatar if provided
  if (file) {
    try {
      const fileUrl = await S3Uploader.uploadToS3(
        file,
        `users/avatar/${userId}`,
      );
      avatar = fileUrl.Location;
    } catch (error) {
      throw new ApiError(
        httpStatus.SERVICE_UNAVAILABLE,
        "Profile image upload failed.",
      );
    }
  }

  // Build dynamic update query
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (payload.name !== undefined) {
    updates.push(`name = $${paramCount++}`);
    values.push(payload.name);
  }

  if (payload.phone_number !== undefined) {
    updates.push(`phone_number = $${paramCount++}`);
    values.push(payload.phone_number);
  }

  if (payload.email !== undefined) {
    updates.push(`email = $${paramCount++}`);
    values.push(payload.email);
  }

  if (payload.address !== undefined) {
    updates.push(`address = $${paramCount++}`);
    values.push(payload.address);
  }

  if (payload.date_of_birth !== undefined) {
    updates.push(`date_of_birth = $${paramCount++}`);
    values.push(payload.date_of_birth);
  }

  if (avatar !== existingUser.avatar) {
    updates.push(`avatar = $${paramCount++}`);
    values.push(avatar);
  }

  if (payload.status !== undefined) {
    updates.push(`status = $${paramCount++}::"UserStatus"`);
    values.push(payload.status);
  }

  if (payload.is_active !== undefined) {
    updates.push(`is_active = $${paramCount++}`);
    values.push(payload.is_active);
  }

  if (updates.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No fields to update");
  }

  updates.push(`"updatedAt" = CURRENT_TIMESTAMP`);
  values.push(userId);

  const queryText = `
        UPDATE users 
        SET ${updates.join(", ")}
        WHERE id = $${paramCount}
        RETURNING 
            id,
            name,
            phone_number,
            email,
            address,
            avatar,
            date_of_birth,
            role,
            status,
            is_active,
            "createdAt" as "createdAt",
            "updatedAt" as "updatedAt"
    `;

  const result = await query(queryText, values);

  return result.rows[0];
};

export const UserService = {
  myProfile,
  allUsers,
  updateUser,
};
