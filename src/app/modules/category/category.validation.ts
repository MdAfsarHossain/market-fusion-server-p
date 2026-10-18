import z from "zod";

const createCategory = z.object({
  body: z.object({
    name: z
      .string({
        required_error: "Category name is required!",
      })
      .min(2, "Category name should be at least 2 characters"),
    parent_id: z.string().uuid("parent_id must be a valid uuid").optional(),
    description: z.string().optional(),
    product_type: z
      .enum(["PHYSICAL", "DIGITAL", "SERVICE", "RENTAL"], {
        errorMap: () => {
          return {
            message:
              "Product type should be PHYSICAL, DIGITAL, SERVICE or RENTAL",
          };
        },
      })
      .optional(),
    sort_order: z.number().int().optional(),
  }),
});

const updateCategory = z.object({
  body: z.object({
    name: z.string().min(2, "Category name should be at least 2 characters").optional(),
    parent_id: z
      .string()
      .uuid("parent_id must be a valid uuid")
      .nullable()
      .optional(),
    description: z.string().optional(),
    product_type: z
      .enum(["PHYSICAL", "DIGITAL", "SERVICE", "RENTAL"])
      .nullable()
      .optional(),
    sort_order: z.number().int().optional(),
    is_active: z.boolean().optional(),
  }),
});

export const CategoryValidation = {
  createCategory,
  updateCategory,
};
