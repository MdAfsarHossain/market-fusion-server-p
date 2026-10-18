import z from "zod";

const demoLogin = z.object({
  body: z.object({
    role: z.enum(["BUYER", "VENDOR", "ADMIN"], {
      errorMap: () => ({ message: "Role should be BUYER, VENDOR or ADMIN" }),
    }),
  }),
});

export const DemoValidation = { demoLogin };
