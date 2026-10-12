import config from "../../../config";
import { query } from "../../utils/db";
// import prisma from "../../lib/prisma";
import sentEmailUtility from "../../utils/sentEmailUtility";

export const OTPFn = async (
  email: string,
  userId: string,
  emailSubject: string,
  emailTemplate: any,
) => {
  const OTP_EXPIRY_TIME = Number(config.otp_expiry_time) * 60 * 1000;
  const expiry = new Date(Date.now() + OTP_EXPIRY_TIME);
  const otp_code = Math.floor(100000 + Math.random() * 900000);
  // const emailSubject = "OTP Verification";
  const emailText = `Your OTP is: ${otp_code}`;
  // console.log(typeof emailTemplate)
  const emailHTML = emailTemplate(otp_code);
  await sentEmailUtility(email, emailSubject, emailHTML);

  // const existingOtp = await prisma.oTP.findFirst({
  //   where: { userId, },
  // });

  // if (existingOtp) {
  //   await prisma.oTP.update({
  //     where: {
  //       id: existingOtp.id,
  //     },
  //     data: {
  //       otpCode: otpCode.toString(),
  //       userId,
  //       expiry,
  //     },
  //   });
  // } else {
  //   await prisma.oTP.create({
  //     data: {
  //       otpCode: otpCode.toString(),
  //       userId,
  //       expiry,
  //     },
  //   });
  // }

  // Insert or update OTP using UPSERT
  // await query(`
  //       INSERT INTO otp (user_id, otp_code, expiry, "createdAt", "updatedAt")
  //       VALUES ($1::uuid, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  //       ON CONFLICT (user_id)
  //       DO UPDATE SET
  //           otp_code = EXCLUDED.otp_code,
  //           expiry = EXCLUDED.expiry,
  //           "updatedAt" = CURRENT_TIMESTAMP
  //   `, [userId, otp_code, expiry]);

  // Check if OTP exists for this user
  const existingOtp = await query(
    `
            SELECT id FROM otp WHERE user_id = $1::uuid
        `,
    [userId],
  );

  if (existingOtp.rows.length > 0) {
    // Update existing OTP
    await query(
      `
                UPDATE otp 
                SET 
                    otp_code = $1,
                    expiry = $2,
                    "updatedAt" = CURRENT_TIMESTAMP
                WHERE user_id = $3::uuid
            `,
      [otp_code, expiry, userId],
    );
  } else {
    // Insert new OTP
    await query(
      `
                INSERT INTO otp (user_id, otp_code, expiry, "createdAt", "updatedAt")
                VALUES ($1::uuid, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `,
      [userId, otp_code, expiry],
    );
  }

  // console.log(`OTP sent to ${email}: ${otp_code}`);

  return;
};
