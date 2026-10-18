import z from "zod";

const createCoupon = z.object({
  body: z.object({
    code: z
      .string({
        required_error: "Coupon code is required!",
      })
      .min(3, "A coupon code should be at least 3 characters")
      .max(60)
      .regex(
        /^[A-Za-z0-9_-]+$/,
        "A coupon code may only contain letters, numbers, dashes and underscores",
      ),
    name: z
      .string({
        required_error: "Coupon name is required!",
      })
      .min(3, "Please give this coupon a clearer name"),
    description: z.string().optional(),
    // Admins may target a specific store; a vendor's coupon is always their own
    store_id: z.string().uuid("store_id must be a valid uuid").optional(),
    discount_type: z.enum(["PERCENTAGE", "FIXED"], {
      errorMap: () => {
        return { message: "Discount type should be PERCENTAGE or FIXED" };
      },
    }),
    discount_value: z
      .number({
        required_error: "Discount value is required!",
      })
      .positive("Discount value must be greater than zero"),
    max_discount_amount: z.number().positive().optional(),
    min_order_amount: z.number().min(0).optional(),
    usage_limit: z.number().int().positive().optional(),
    usage_limit_per_user: z.number().int().positive().optional(),
    starts_at: z.string().datetime({ offset: true }).optional(),
    expires_at: z.string().datetime({ offset: true }).optional(),
  }),
});

const updateCoupon = z.object({
  body: z.object({
    name: z.string().min(3).optional(),
    description: z.string().optional(),
    discount_type: z.enum(["PERCENTAGE", "FIXED"]).optional(),
    discount_value: z.number().positive().optional(),
    max_discount_amount: z.number().positive().nullable().optional(),
    min_order_amount: z.number().min(0).optional(),
    usage_limit: z.number().int().positive().nullable().optional(),
    usage_limit_per_user: z.number().int().positive().nullable().optional(),
    starts_at: z.string().datetime({ offset: true }).optional(),
    expires_at: z.string().datetime({ offset: true }).nullable().optional(),
    is_active: z.boolean().optional(),
  }),
});

const previewCoupon = z.object({
  body: z.object({
    code: z.string({
      required_error: "Coupon code is required!",
    }),
  }),
});

export const CouponValidation = {
  createCoupon,
  updateCoupon,
  previewCoupon,
};
