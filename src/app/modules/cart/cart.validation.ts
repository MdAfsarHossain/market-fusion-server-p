import z from "zod";

const addToCart = z.object({
  body: z.object({
    product_id: z
      .string({
        required_error: "product_id is required!",
      })
      .uuid("product_id must be a valid uuid"),
    variant_id: z.string().uuid("variant_id must be a valid uuid").optional(),
    quantity: z
      .number()
      .int()
      .min(1, "Quantity should be at least 1")
      .optional(),
    // Required for SERVICE products
    booking_start: z.string().datetime({
      offset: true,
      message: "booking_start must be a valid ISO date time",
    }).optional(),
    // Required for RENTAL products
    rental_start: z.string().datetime({
      offset: true,
      message: "rental_start must be a valid ISO date time",
    }).optional(),
    rental_end: z.string().datetime({
      offset: true,
      message: "rental_end must be a valid ISO date time",
    }).optional(),
  }),
});

const updateCartItem = z.object({
  body: z.object({
    quantity: z
      .number({
        required_error: "Quantity is required!",
      })
      .int()
      .min(1, "Quantity should be at least 1"),
  }),
});

export const CartValidation = {
  addToCart,
  updateCartItem,
};
