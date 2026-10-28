import z from "zod";

const createStore = z.object({
  body: z.object({
    name: z
      .string({
        required_error: "Store name is required!",
      })
      .min(3, "Store name should be at least 3 characters"),
    tagline: z.string().optional(),
    description: z.string().optional(),
    email: z
      .string()
      .email({
        message: "Invalid email format!",
      })
      .optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
  }),
});

const updateStore = z.object({
  body: z.object({
    name: z.string().min(3, "Store name should be at least 3 characters").optional(),
    tagline: z.string().optional(),
    description: z.string().optional(),
    email: z
      .string()
      .email({
        message: "Invalid email format!",
      })
      .optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    city: z.string().optional(),
    country: z.string().optional(),
  }),
});

const updateStoreStatus = z.object({
  body: z.object({
    status: z.enum(["PENDING", "ACTIVE", "SUSPENDED", "REJECTED"], {
      errorMap: () => {
        return {
          message: "Status should be PENDING, ACTIVE, SUSPENDED or REJECTED",
        };
      },
    }),
    rejection_reason: z.string().optional(),
    commission_rate: z
      .number()
      .min(0, "Commission rate cannot be negative")
      .max(100, "Commission rate cannot be more than 100")
      .optional(),
  }),
});

export const StoreValidation = {
  createStore,
  updateStore,
  updateStoreStatus,
};
