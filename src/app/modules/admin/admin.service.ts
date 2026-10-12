import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { query } from "../../utils/db";

// All KYC Documents List - Raw SQL Version
const getAllKYCDocuments = async (pagination: any) => {
  const page = parseInt(pagination.page) || 1;
  const limit = parseInt(pagination.limit) || 10;
  const offset = (page - 1) * limit;

  // Get KYC documents with user information
  const kycDocuments = await query(
    `
        SELECT 
            bd.*, 
            json_build_object(
                'id', u.id,
                'name', u.name,
                'email', u.email,
                'avatar', u.avatar,
                'phone_number', u.phone_number,
                'status', u.status,
                'is_active', u.is_active,
                'kyc_verification_status', u.kyc_verification_status
            ) as user
        FROM businesses bd
        LEFT JOIN users u ON bd.creator_id = u.id
        ORDER BY bd."createdAt" DESC
        LIMIT $1 OFFSET $2
    `,
    [limit, offset],
  );

  // Get total count for pagination
  const totalCountResult = await query(`
        SELECT COUNT(*) as total
        FROM businesses
    `);

  const total = parseInt(totalCountResult.rows[0].total);
  const totalPage = Math.ceil(total / limit);

  return {
    data: kycDocuments.rows,
    meta: {
      page,
      limit,
      total,
      totalPage,
      hasNextPage: page < totalPage,
      hasPrevPage: page > 1,
    },
  };
};

export const AdminService = {
  getAllKYCDocuments,
};
