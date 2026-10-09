// import config from "../../config";

// const nodemailer = require("nodemailer");
// const smtpTransporter = require("nodemailer-smtp-transport");

// let sentEmailUtility = async (
//   emailTo: string,
//   EmailSubject: string,
//   EmailHTML?: string, // HTML content as a parameter
//   EmailText?: string,
// ) => {
//   let transporter = nodemailer.createTransport(
//     smtpTransporter({
//       // host: "smtp.hostinger.com",
//       host: "smtp.gmail.com",
//       secure: true,
//       // port: 465,
//       port: 587,
//       auth: {
//         user: config.emailSender.email,
//         pass: config.emailSender.app_pass,
//       },
//       tls: {
//         rejectUnauthorized: false, // OPTIONAL: Bypass SSL issues (only if necessary)
//       },
//     }),
//   );

//   let mailOption = {
//     from: "Resqueu <" + config.emailSender.email + ">",
//     to: emailTo,
//     subject: EmailSubject,
//     text: EmailText,
//     html: EmailHTML,
//   };

//   return await transporter.sendMail(mailOption);
// };
// export default sentEmailUtility;

import config from "../../config";
import nodemailer from "nodemailer";

let sentEmailUtility = async (
  emailTo: string,
  EmailSubject: string,
  EmailHTML?: string,
  EmailText?: string,
) => {
  // Verify config exists
  if (!config.emailSender?.email || !config.emailSender?.app_pass) {
    throw new Error("Email configuration missing");
  }

  let transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    auth: {
      user: config.emailSender.email,
      pass: config.emailSender.app_pass,
    },
    // Add connection timeout
    connectionTimeout: 10000,
  });

  // Verify connection before sending
  await transporter.verify();

  let mailOption = {
    from: `"Resqueu" <${config.emailSender.email}>`,
    to: emailTo,
    subject: EmailSubject,
    text: EmailText || "",
    html: EmailHTML || "",
  };

  return await transporter.sendMail(mailOption);
};

export default sentEmailUtility;
