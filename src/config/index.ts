import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.join(process.cwd(), ".env") });

export default {
  env: process.env.NODE_ENV,
  port: process.env.PORT,
  super_admin_password: process.env.SUPER_ADMIN_PASSWORD,
  bcrypt_salt_rounds: process.env.BCRYPT_SALT_ROUNDS || "12",
  otp_expiry_time: process.env.OTP_ACCESS_EXPIRES_IN || "5",
  jwt: {
    access_secret: process.env.JWT_ACCESS_SECRET,
    access_expires_in: process.env.JWT_ACCESS_EXPIRES_IN,
    refresh_secret: process.env.JWT_REFRESH_SECRET,
    refresh_expires_in: process.env.JWT_REFRESH_EXPIRES_IN,

    reset_pass_secret: process.env.JWT_RESET_PASS_SECRET,
    reset_pass_token_expires_in: process.env.JWT_RESET_PASS_EXPIRES_IN,
    store_address_token_expires_in: process.env.JWT_STORE_ADDRESS_EXPIRES_IN,
  },
  S3: {
    accessKeyId: process.env.S3_ACCESS_KEY,
    secretAccessKey: process.env.S3_SECRET_KEY,
    region: process.env.S3_REGION,
    bucketName: process.env.S3_BUCKET_NAME,
    endpoint: process.env.S3_ENDPOINT,
  },  
  emailSender: {
    email: process.env.EMAIL,
    app_pass: process.env.EMAIL_PASSWORD,
    contact_mail_address: process.env.CONTACT_MAIL_ADDRESS,
},
  stripe: {
    secret_key: process.env.STRIPE_SECRET_KEY,
    public_key: process.env.STRIPE_PUBLIC_KEY,
    webhook_secret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  frontend: {
    success_url: process.env.FRONTEND_SUCCESS_URL,
    cancel_url: process.env.FRONTEND_CANCEL_URL,
  },
  redis: {
    url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
    password: process.env.REDIS_PASSWORD,
  },
  wallet: {
    min_withdrawal: process.env.MIN_WITHDRAWAL_AMOUNT || "20",
  },
}
