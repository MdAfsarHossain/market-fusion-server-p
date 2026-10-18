import z from "zod";

const adjustStock = z.object({
  body: z.object({
    product_id: z
      .string({
        required_error: "product_id is required!",
      })
      .uuid("product_id must be a valid uuid"),
    variant_id: z.string().uuid("variant_id must be a valid uuid").optional(),
    // ADD moves the stock by `quantity`, SET replaces it outright
    mode: z.enum(["ADD", "SET"], {
      errorMap: () => {
        return { message: "Mode should be ADD or SET" };
      },
    }),
    quantity: z
      .number({
        required_error: "Quantity is required!",
      })
      .int("Quantity must be a whole number"),
    note: z.string().max(500).optional(),
  }),
});

const updateLowStockThreshold = z.object({
  body: z.object({
    product_id: z
      .string({
        required_error: "product_id is required!",
      })
      .uuid("product_id must be a valid uuid"),
    low_stock_threshold: z
      .number({
        required_error: "low_stock_threshold is required!",
      })
      .int()
      .min(0, "The threshold cannot be negative"),
  }),
});

export const InventoryValidation = {
  adjustStock,
  updateLowStockThreshold,
};
