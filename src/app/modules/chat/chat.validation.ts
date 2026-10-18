import z from "zod";

const startConversation = z.object({
  body: z.object({
    store_id: z
      .string({
        required_error: "store_id is required!",
      })
      .uuid("store_id must be a valid uuid"),
    // Pins the thread to one order, keeping order questions separate
    order_id: z.string().uuid("order_id must be a valid uuid").optional(),
    subject: z.string().max(255).optional(),
  }),
});

const sendMessage = z.object({
  body: z.object({
    body: z
      .string({
        required_error: "A message is required!",
      })
      .min(1, "A message cannot be empty")
      .max(4000, "That message is too long"),
    attachments: z
      .array(z.string())
      .max(5, "Up to 5 attachments per message")
      .optional(),
  }),
});

export const ChatValidation = {
  startConversation,
  sendMessage,
};
