import z from "zod";

const createAddress = z.object({
  body: z.object({
    label: z.string().optional(),
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
    type: z.enum(["SHIPPING", "BILLING"]).optional(),
    is_default: z.boolean().optional(),
  }),
});

const updateAddress = z.object({
  body: z.object({
    label: z.string().optional(),
    full_name: z.string().optional(),
    phone: z.string().optional(),
    address_line1: z.string().optional(),
    address_line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postal_code: z.string().optional(),
    country: z.string().optional(),
    type: z.enum(["SHIPPING", "BILLING"]).optional(),
    is_default: z.boolean().optional(),
  }),
});

export const AddressValidation = {
  createAddress,
  updateAddress,
};
