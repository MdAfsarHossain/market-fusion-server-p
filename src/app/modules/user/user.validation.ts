import z from "zod";

const updateUser = z.object({
  body: z.object({
    name: z.string().optional(),
    avatar: z.string().optional(),
    phone_number: z.string().optional(),
    description: z.string().optional(),
    portfolio_images: z.array(z.string()).optional(),
    date_of_birth: z.string().optional(),
  }),
});

export const UserValidation = {
  updateUser,
};
