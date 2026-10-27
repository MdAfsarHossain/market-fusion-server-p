import z from "zod";

const permissionEnum = z.enum([
  "PRODUCTS",
  "INVENTORY",
  "ORDERS",
  "BOOKINGS",
  "COUPONS",
  "REVIEWS",
  "CHAT",
  "ANALYTICS",
  "WALLET",
]);

const inviteStaff = z.object({
  body: z.object({
    email: z
      .string({
        required_error: "Email is required!",
      })
      .email({ message: "Invalid email format!" }),
    role: z.enum(["MANAGER", "STAFF"], {
      errorMap: () => {
        return { message: "Role should be MANAGER or STAFF" };
      },
    }),
    permissions: z
      .array(permissionEnum)
      .min(1, "Give this person at least one area to work in"),
  }),
});

const updateStaff = z.object({
  body: z.object({
    role: z.enum(["MANAGER", "STAFF"]).optional(),
    permissions: z.array(permissionEnum).optional(),
  }),
});

export const StaffValidation = {
  inviteStaff,
  updateStaff,
};
