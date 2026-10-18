import httpStatus from "http-status";
import ApiError from "../../errors/ApiError";
import { query } from "../../utils/db";
import { S3Uploader } from "../../lib/S3Uploader";
import slugify from "../../utils/slugify";

// Build a category slug that is guaranteed not to collide
const generateUniqueSlug = async (name: string) => {
  const baseSlug = slugify(name) || "category";
  let slug = baseSlug;
  let suffix = 1;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await query(`SELECT id FROM categories WHERE slug = $1`, [
      slug,
    ]);

    if (existing.rows.length === 0) {
      break;
    }

    suffix += 1;
    slug = `${baseSlug}-${suffix}`;
  }

  return slug;
};

// Upload the category icon / image when they are part of the request
const uploadCategoryAssets = async (slug: string, files?: any) => {
  const assets: { icon?: string; image?: string } = {};

  if (!files) {
    return assets;
  }

  try {
    if (files.icon?.[0]) {
      const uploaded = await S3Uploader.uploadToS3(
        files.icon[0],
        `categories/${slug}/icon`,
      );
      assets.icon = uploaded.Location;
    }

    if (files.image?.[0]) {
      const uploaded = await S3Uploader.uploadToS3(
        files.image[0],
        `categories/${slug}/image`,
      );
      assets.image = uploaded.Location;
    }
  } catch (error) {
    throw new ApiError(
      httpStatus.SERVICE_UNAVAILABLE,
      "Category image upload failed.",
    );
  }

  return assets;
};

// Turn a flat category list into a parent → children tree
const buildCategoryTree = (rows: any[]) => {
  const lookup = new Map<string, any>();
  const roots: any[] = [];

  rows.forEach((row) => {
    lookup.set(row.id, { ...row, children: [] });
  });

  rows.forEach((row) => {
    const node = lookup.get(row.id);

    if (row.parent_id && lookup.has(row.parent_id)) {
      lookup.get(row.parent_id).children.push(node);
    } else {
      roots.push(node);
    }
  });

  return roots;
};

// Create Category
const createCategory = async (payload: any, files?: any) => {
  // A parent must exist when one is supplied
  if (payload.parent_id) {
    const parentResult = await query(
      `
            SELECT id FROM categories WHERE id = $1::uuid
        `,
      [payload.parent_id],
    );

    if (parentResult.rows.length === 0) {
      throw new ApiError(httpStatus.NOT_FOUND, "Parent category not found.");
    }
  }

  const slug = await generateUniqueSlug(payload.name);
  const assets = await uploadCategoryAssets(slug, files);

  const result = await query(
    `
        INSERT INTO categories (
            parent_id,
            name,
            slug,
            description,
            icon,
            image,
            product_type,
            sort_order,
            "createdAt",
            "updatedAt"
        ) VALUES (
            $1::uuid, $2, $3, $4, $5, $6, $7::"ProductType", $8,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        RETURNING *
    `,
    [
      payload.parent_id || null,
      payload.name,
      slug,
      payload.description || null,
      assets.icon || null,
      assets.image || null,
      payload.product_type || null,
      payload.sort_order ?? 0,
    ],
  );

  return result.rows[0];
};

// All Categories - flat, paginated, filterable
const allCategories = async (filters: any) => {
  const page = parseInt(filters.page) || 1;
  const limit = parseInt(filters.limit) || 50;
  const offset = (page - 1) * limit;
  const searchTerm = filters.searchTerm || null;
  const productType = filters.product_type || null;
  const parentId = filters.parent_id || null;

  const categoriesResult = await query(
    `
        SELECT
            c.*,
            (
                SELECT COUNT(*) FROM products p
                WHERE p.category_id = c.id AND p.status = 'PUBLISHED'::"ProductStatus"
            ) as product_count
        FROM categories c
        WHERE c.is_active = true
            AND ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR c.product_type = $2::"ProductType")
            AND ($3::uuid IS NULL OR c.parent_id = $3::uuid)
        ORDER BY c.sort_order ASC, c.name ASC
        LIMIT $4 OFFSET $5
    `,
    [searchTerm, productType, parentId, limit, offset],
  );

  const countResult = await query(
    `
        SELECT COUNT(*) as total
        FROM categories c
        WHERE c.is_active = true
            AND ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%')
            AND ($2::text IS NULL OR c.product_type = $2::"ProductType")
            AND ($3::uuid IS NULL OR c.parent_id = $3::uuid)
    `,
    [searchTerm, productType, parentId],
  );

  const total = parseInt(countResult.rows[0].total);
  const totalPage = Math.ceil(total / limit);

  return {
    meta: {
      page,
      limit,
      total,
      totalPage,
      hasNextPage: page < totalPage,
      hasPrevPage: page > 1,
    },
    data: categoriesResult.rows,
  };
};

// Category Tree - the full nested navigation menu
const categoryTree = async (filters: any) => {
  const productType = filters.product_type || null;

  const result = await query(
    `
        SELECT
            c.id,
            c.parent_id,
            c.name,
            c.slug,
            c.icon,
            c.image,
            c.product_type,
            c.sort_order
        FROM categories c
        WHERE c.is_active = true
            AND ($1::text IS NULL OR c.product_type = $1::"ProductType" OR c.product_type IS NULL)
        ORDER BY c.sort_order ASC, c.name ASC
    `,
    [productType],
  );

  return buildCategoryTree(result.rows);
};

// Single Category by slug, with its immediate children
const categoryBySlug = async (slug: string) => {
  const result = await query(
    `
        SELECT
            c.*,
            (
                SELECT COALESCE(json_agg(
                    json_build_object(
                        'id', child.id,
                        'name', child.name,
                        'slug', child.slug,
                        'icon', child.icon,
                        'image', child.image
                    ) ORDER BY child.sort_order ASC
                ), '[]'::json)
                FROM categories child
                WHERE child.parent_id = c.id AND child.is_active = true
            ) as children
        FROM categories c
        WHERE c.slug = $1 AND c.is_active = true
    `,
    [slug],
  );

  if (result.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Category not found.");
  }

  return result.rows[0];
};

// Update Category
const updateCategory = async (
  categoryId: string,
  payload: any,
  files?: any,
) => {
  const categoryResult = await query(
    `
        SELECT id, slug FROM categories WHERE id = $1::uuid
    `,
    [categoryId],
  );

  if (categoryResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Category not found.");
  }

  // A category can never be its own parent
  if (payload.parent_id && payload.parent_id === categoryId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "A category cannot be its own parent.",
    );
  }

  const existingCategory = categoryResult.rows[0];
  const assets = await uploadCategoryAssets(existingCategory.slug, files);

  // Build dynamic update query
  const updates: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (payload.name !== undefined) {
    updates.push(`name = $${paramCount++}`);
    values.push(payload.name);
  }

  if (payload.parent_id !== undefined) {
    updates.push(`parent_id = $${paramCount++}::uuid`);
    values.push(payload.parent_id || null);
  }

  if (payload.description !== undefined) {
    updates.push(`description = $${paramCount++}`);
    values.push(payload.description);
  }

  if (payload.product_type !== undefined) {
    updates.push(`product_type = $${paramCount++}::"ProductType"`);
    values.push(payload.product_type || null);
  }

  if (payload.sort_order !== undefined) {
    updates.push(`sort_order = $${paramCount++}`);
    values.push(payload.sort_order);
  }

  if (payload.is_active !== undefined) {
    updates.push(`is_active = $${paramCount++}`);
    values.push(payload.is_active);
  }

  if (assets.icon) {
    updates.push(`icon = $${paramCount++}`);
    values.push(assets.icon);
  }

  if (assets.image) {
    updates.push(`image = $${paramCount++}`);
    values.push(assets.image);
  }

  if (updates.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No fields to update");
  }

  updates.push(`"updatedAt" = CURRENT_TIMESTAMP`);
  values.push(categoryId);

  const result = await query(
    `
        UPDATE categories
        SET ${updates.join(", ")}
        WHERE id = $${paramCount}::uuid
        RETURNING *
    `,
    values,
  );

  return result.rows[0];
};

// Delete Category - blocked while it is still in use
const deleteCategory = async (categoryId: string) => {
  const categoryResult = await query(
    `
        SELECT
            c.id,
            (SELECT COUNT(*) FROM categories child WHERE child.parent_id = c.id) as child_count,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count
        FROM categories c
        WHERE c.id = $1::uuid
    `,
    [categoryId],
  );

  if (categoryResult.rows.length === 0) {
    throw new ApiError(httpStatus.NOT_FOUND, "Category not found.");
  }

  const category = categoryResult.rows[0];

  if (parseInt(category.child_count) > 0) {
    throw new ApiError(
      httpStatus.CONFLICT,
      "This category has sub categories. Please delete them first.",
    );
  }

  if (parseInt(category.product_count) > 0) {
    throw new ApiError(
      httpStatus.CONFLICT,
      "This category still has products. Please move them first.",
    );
  }

  await query(`DELETE FROM categories WHERE id = $1::uuid`, [categoryId]);

  return null;
};

export const CategoryService = {
  createCategory,
  allCategories,
  categoryTree,
  categoryBySlug,
  updateCategory,
  deleteCategory,
};
