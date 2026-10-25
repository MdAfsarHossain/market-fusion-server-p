import z from "zod";

const addressSchema = z.object({
  full_name: z.string({
    required_error: "Full name is required!",
  }),
  phone: z.string({
    required_error: "Phone is required!",
  }),
  address_line1: z.string({
    required_error: "Address line 1 is required!",
  }),
  address_line2: z.string().optional(),
  city: z.string({
    required_error: "City is required!",
  }),
  state: z.string().optional(),
  postal_code: z.string({
    required_error: "Postal code is required!",
  }),
  country: z.string({
    required_error: "Country is required!",
  }),
});

const checkout = z.object({
  body: z
    .object({
      address_id: z.string().uuid("address_id must be a valid uuid").optional(),
      shipping_address: addressSchema.optional(),
      billing_address: addressSchema.optional(),
      customer_note: z.string().max(1000).optional(),
    })
    .refine((data) => data.address_id || data.shipping_address, {
      message: "Either an address_id or a shipping_address is required",
      path: ["address_id"],
    }),
});

const cancelOrder = z.object({
  body: z.object({
    reason: z.string().max(500).optional(),
  }),
});

const updateSubOrderStatus = z.object({
  body: z.object({
    status: z.enum(
      [
        "PROCESSING",
        "SHIPPED",
        "DELIVERED",
        "COMPLETED",
        "CANCELLED",
      ],
      {
        errorMap: () => {
          return {
            message:
              "Status should be PROCESSING, SHIPPED, DELIVERED, COMPLETED or CANCELLED",
          };
        },
      },
    ),
    vendor_note: z.string().max(1000).optional(),
    cancellation_reason: z.string().max(500).optional(),
  }),
});

export const OrderValidation = {
  checkout,
  cancelOrder,
  updateSubOrderStatus,
};
