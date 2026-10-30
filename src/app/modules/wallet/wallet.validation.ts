import z from "zod";

const requestWithdrawal = z.object({
  body: z.object({
    amount: z
      .number({
        required_error: "Amount is required!",
      })
      .positive("Amount must be greater than zero"),
    method: z.enum(["BANK_TRANSFER", "PAYPAL", "STRIPE", "MOBILE_BANKING"], {
      errorMap: () => {
        return {
          message:
            "Method should be BANK_TRANSFER, PAYPAL, STRIPE or MOBILE_BANKING",
        };
      },
    }),
    account_details: z
      .record(z.any(), {
        required_error: "Account details are required!",
      })
      .refine((value) => Object.keys(value).length > 0, {
        message: "Please provide the account details for this payout method",
      }),
  }),
});

const updateWithdrawalStatus = z.object({
  body: z.object({
    status: z.enum(["APPROVED", "REJECTED", "PAID"], {
      errorMap: () => {
        return { message: "Status should be APPROVED, REJECTED or PAID" };
      },
    }),
    admin_note: z.string().max(500).optional(),
  }),
});

const adminAdjustWallet = z.object({
  body: z.object({
    user_id: z
      .string({
        required_error: "user_id is required!",
      })
      .uuid("user_id must be a valid uuid"),
    type: z.enum(["CREDIT", "DEBIT"], {
      errorMap: () => {
        return { message: "Type should be CREDIT or DEBIT" };
      },
    }),
    amount: z
      .number({
        required_error: "Amount is required!",
      })
      .positive("Amount must be greater than zero"),
    reason: z
      .string({
        required_error: "A reason is required for every manual adjustment!",
      })
      .min(3, "Please give a longer reason"),
  }),
});

export const WalletValidation = {
  requestWithdrawal,
  updateWithdrawalStatus,
  adminAdjustWallet,
};
