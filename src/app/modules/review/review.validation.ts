import z from "zod";

const createReview = z.object({
  body: z.object({
    order_item_id: z
      .string({
        required_error: "order_item_id is required!",
      })
      .uuid("order_item_id must be a valid uuid"),
    rating: z
      .number({
        required_error: "Rating is required!",
      })
      .int()
      .min(1, "Rating must be between 1 and 5")
      .max(5, "Rating must be between 1 and 5"),
    title: z.string().max(255).optional(),
    comment: z.string().max(3000).optional(),
    images: z.array(z.string()).max(5, "Up to 5 images per review").optional(),
  }),
});

const updateReview = z.object({
  body: z.object({
    rating: z
      .number()
      .int()
      .min(1, "Rating must be between 1 and 5")
      .max(5, "Rating must be between 1 and 5")
      .optional(),
    title: z.string().max(255).optional(),
    comment: z.string().max(3000).optional(),
    images: z.array(z.string()).max(5, "Up to 5 images per review").optional(),
  }),
});

const replyToReview = z.object({
  body: z.object({
    reply: z
      .string({
        required_error: "A reply is required!",
      })
      .min(2, "Please write a longer reply")
      .max(2000),
  }),
});

const updateReviewStatus = z.object({
  body: z.object({
    status: z.enum(["PENDING", "PUBLISHED", "REJECTED"], {
      errorMap: () => {
        return { message: "Status should be PENDING, PUBLISHED or REJECTED" };
      },
    }),
    rejection_reason: z.string().max(500).optional(),
  }),
});

export const ReviewValidation = {
  createReview,
  updateReview,
  replyToReview,
  updateReviewStatus,
};
