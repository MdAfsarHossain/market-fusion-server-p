import z from "zod";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

const setAvailability = z.object({
  body: z.object({
    // The whole week is replaced in one call, so an empty array clears it
    windows: z.array(
      z
        .object({
          day_of_week: z
            .number({ required_error: "day_of_week is required!" })
            .int()
            .min(0, "day_of_week must be 0 (Sunday) to 6 (Saturday)")
            .max(6, "day_of_week must be 0 (Sunday) to 6 (Saturday)"),
          start_time: z
            .string({ required_error: "start_time is required!" })
            .regex(timePattern, "start_time must look like 09:00"),
          end_time: z
            .string({ required_error: "end_time is required!" })
            .regex(timePattern, "end_time must look like 17:00"),
        })
        .refine((window) => window.end_time > window.start_time, {
          message: "end_time must be after start_time",
          path: ["end_time"],
        }),
    ),
  }),
});

const updateBookingStatus = z.object({
  body: z.object({
    status: z.enum(
      ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"],
      {
        errorMap: () => {
          return {
            message:
              "Status should be CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED or NO_SHOW",
          };
        },
      },
    ),
    vendor_note: z.string().max(1000).optional(),
    cancellation_reason: z.string().max(500).optional(),
  }),
});

const rescheduleBooking = z.object({
  body: z.object({
    scheduled_start: z
      .string({ required_error: "scheduled_start is required!" })
      .datetime({
        offset: true,
        message: "scheduled_start must be a valid ISO date time",
      }),
    vendor_note: z.string().max(1000).optional(),
  }),
});

const addTimeOff = z.object({
  body: z.object({
    product_id: z.string().uuid("product_id must be a valid uuid").optional(),
    starts_at: z.string({ required_error: "starts_at is required!" }).datetime({
      offset: true,
      message: "starts_at must be a valid ISO date time",
    }),
    ends_at: z.string({ required_error: "ends_at is required!" }).datetime({
      offset: true,
      message: "ends_at must be a valid ISO date time",
    }),
    reason: z.string().max(255).optional(),
  }),
});

export const ServiceValidation = {
  setAvailability,
  updateBookingStatus,
  rescheduleBooking,
  addTimeOff,
};
