// import { Role } from "@prisma/client";
import z from "zod";

const phoneRegex =
  /^[+]*[0-9]{1,4}[ -]?[0-9]{1,4}[ -]?[0-9]{1,4}[ -]?[0-9]{1,4}$/;

const registerUser = z.object({
  body: z.object({
    name: z.string({
      required_error: "Name is required!",
    }),
    email: z
      .string({
        required_error: "Email is required!",
      })
      .email({
        message: "Invalid email format!",
      }),
    phone_number: z
      .string({
        required_error: "Phone Number is required!",
      })
      .regex(phoneRegex, {
        message:
          "Phone number is not valid. Please enter a valid phone number.",
      }),
    password: z
      .string({
        required_error: "Password is required!",
      })
      .min(8, "Password should be at least 8 characters"),
    avatar: z.string().optional(),
    portfolio_images: z.array(z.string()).optional(),
    description: z.string().optional(),
    business_name: z.string().optional(),
    date_of_birth: z
      .string({
        required_error: "Date of Birth is required!",
      })
      .optional(),
    role: z.enum(["USER", "BUSINESS", "ADMIN"], {
      errorMap: () => {
        return { message: `Role should be either BUSINESS or USER` };
      },
    }),
    fcm_token: z.string().optional(),
    kvk_or_eu_vat: z.string().optional(),
    id_legal_representative: z.string().optional(),
    license_or_utility_bill: z.string().optional(),
  }),
});

const verifyOtp = z.object({
  body: z.object({
    userId: z.string({
      required_error: "userId is required!",
    }),
    otpCode: z
      .string({
        required_error: "otpCode is required!",
      })
      .length(6, "otpCode must be 6 digit"),
  }),
});

const loginUser = z.object({
  body: z.object({
    email: z
      .string({
        required_error: "Email is required!",
      })
      .email({
        message: "Invalid email format!",
      }),
    password: z.string({
      required_error: "Password is required!",
    }),
    fcmToken: z.string().optional(),
  }),
});

const forgotPassword = z.object({
  body: z.object({
    email: z
      .string({
        required_error: "Email is required!",
      })
      .email({
        message: "Invalid email format!",
      }),
  }),
});

const resetPassword = z.object({
  body: z.object({
    newPassword: z
      .string({
        required_error: "Password is required!",
      })
      .min(8, "password should be minimum 8 characters "),
  }),
});

const changePassword = z.object({
  body: z.object({
    oldPassword: z.string({
      required_error: "old Password is required!",
    }),
    newPassword: z
      .string({
        required_error: "new password is required!",
      })
      .min(8, "Password should be minimum 8 characters "),
  }),
});

const resendOtp = z.object({
  body: z.object({
    userId: z.string({
      required_error: "userId is required!",
    }),
  }),
});

export const authValidation = {
  registerUser,
  loginUser,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword,
  resendOtp,
};
