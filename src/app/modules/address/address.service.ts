import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { query, transaction } from "../../utils/db";

// Create Address
const createAddress = async (userId: string, payload: any) => {
  const address = await transaction(async (client) => {
    // The first address a user saves becomes their default automatically
    const existingResult = await client.query(
      `
            SELECT COUNT(*) as total FROM addresses WHERE user_id = $1::uuid
        `,
      [userId],
    );

    const isFirstAddress = parseInt(existingResult.rows[0].total) === 0;
    const isDefault = payload.is_default ?? isFirstAddress;

    // Only one default per address type
    if (isDefault) {
      await client.query(
        `
                UPDATE addresses
                SET is_default = false, "updatedAt" = CURRENT_TIMESTAMP
                WHERE user_id = $1::uuid AND type = $2::"AddressType"
            `,
        [userId, payload.type || "SHIPPING"],
      );
    }

    const result = await client.query(
      `
            INSERT INTO addresses (
                user_id,
                label,
                full_name,
                phone,
                address_line1,
                address_line2,
                city,
                state,
                postal_code,
                country,
                type,
                is_default,
                "createdAt",
                "updatedAt"
            ) VALUES (
                $1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11::"AddressType", $12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING *
        `,
      [
        userId,
        payload.label || null,
        payload.full_name,
        payload.phone,
        payload.address_line1,
        payload.address_line2 || null,
        payload.city,
        payload.state || null,
        payload.postal_code,
        payload.country,
        payload.type || "SHIPPING",
        isDefault,
      ],
    );

    return result.rows[0];
  });

  return address;
};

// My Addresses
const myAddresses = async (userId: string, filters: any) => {
  const type = filters.type || null;

  const result = await query(
    `
        SELECT *
        FROM addresses
        WHERE user_id = $1::uuid
            AND ($2::text IS NULL OR type = $2::"AddressType")
        ORDER BY is_default DESC, "createdAt" DESC
    `,
    [userId, type],
  );

  return result.rows;
};

// Update Address
const updateAddress = async (
  userId: string,
  addressId: string,
  payload: any,
) => {
  const addressResult = await query(
    `
        SELECT id, type FROM addresses WHERE id = $1::uuid AND user_id = $2::uuid
    `,
    [addressId, userId],
  );

  if (addressResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Address not found.");
  }

  const existingAddress = addressResult.rows[0];

  // Build dynamic update query
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (payload.label !== undefined) {
    updates.push(`label = $${paramCount++}`);
    values.push(payload.label);
  }

  if (payload.full_name !== undefined) {
    updates.push(`full_name = $${paramCount++}`);
    values.push(payload.full_name);
  }

  if (payload.phone !== undefined) {
    updates.push(`phone = $${paramCount++}`);
    values.push(payload.phone);
  }

  if (payload.address_line1 !== undefined) {
    updates.push(`address_line1 = $${paramCount++}`);
    values.push(payload.address_line1);
  }

  if (payload.address_line2 !== undefined) {
    updates.push(`address_line2 = $${paramCount++}`);
    values.push(payload.address_line2);
  }

  if (payload.city !== undefined) {
    updates.push(`city = $${paramCount++}`);
    values.push(payload.city);
  }

  if (payload.state !== undefined) {
    updates.push(`state = $${paramCount++}`);
    values.push(payload.state);
  }

  if (payload.postal_code !== undefined) {
    updates.push(`postal_code = $${paramCount++}`);
    values.push(payload.postal_code);
  }

  if (payload.country !== undefined) {
    updates.push(`country = $${paramCount++}`);
    values.push(payload.country);
  }

  if (payload.type !== undefined) {
    updates.push(`type = $${paramCount++}::"AddressType"`);
    values.push(payload.type);
  }

  if (payload.is_default !== undefined) {
    updates.push(`is_default = $${paramCount++}`);
    values.push(payload.is_default);
  }

  if (updates.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No fields to update");
  }

  updates.push(`"updatedAt" = CURRENT_TIMESTAMP`);
  values.push(addressId);

  const updated = await transaction(async (client) => {
    // Promoting this address demotes the previous default of the same type
    if (payload.is_default === true) {
      await client.query(
        `
                UPDATE addresses
                SET is_default = false, "updatedAt" = CURRENT_TIMESTAMP
                WHERE user_id = $1::uuid
                    AND type = $2::"AddressType"
                    AND id != $3::uuid
            `,
        [userId, payload.type || existingAddress.type, addressId],
      );
    }

    const result = await client.query(
      `
            UPDATE addresses
            SET ${updates.join(", ")}
            WHERE id = $${paramCount}::uuid
            RETURNING *
        `,
      values,
    );

    return result.rows[0];
  });

  return updated;
};

// Delete Address
const deleteAddress = async (userId: string, addressId: string) => {
  const result = await query(
    `
        DELETE FROM addresses
        WHERE id = $1::uuid AND user_id = $2::uuid
        RETURNING id
    `,
    [addressId, userId],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Address not found.");
  }

  return null;
};

export const AddressService = {
  createAddress,
  myAddresses,
  updateAddress,
  deleteAddress,
};
