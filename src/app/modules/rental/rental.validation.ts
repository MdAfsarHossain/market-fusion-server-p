import z from "zod";

const markPickedUp = z.object({
  body: z.object({
    condition_note: z.string().max(1000).optional(),
  }),
});

const markReturned = z.object({
  body: z.object({
    // Taken out of the held deposit; the rest goes back to the buyer
    damage_fee: z.number().min(0, "A damage fee cannot be negative").optional(),
    condition_note: z.string().max(1000).optional(),
    vendor_note: z.string().max(1000).optional(),
  }),
});

export const RentalValidation = {
  markPickedUp,
  markReturned,
};
