// import { Role } from "@prisma/client";

const phoneRegex =
  /^[+]*[0-9]{1,4}[ -]?[0-9]{1,4}[ -]?[0-9]{1,4}[ -]?[0-9]{1,4}$/;

export interface IRegisterUser {
  name: string;
  email: string;
  password: string;
  phone: string;
  role: "USER" | "ADMIN" | "SUPERADMIN" | "BUSINESS";
  fcmToken?: string;
}

export interface IOtp {
  userId: string;
  otpCode: string;
}

export interface IUserLogin {
  email: string;
  password: string;
  fcm_token?: string;
}

export interface IChangePassword {
  newPassword: string;
  oldPassword: string;
}

export interface IPartnerRegistration {
  dateTimeFormat: string;
  timezone: string;
  firstName: string;
  lastName: string;
  companyName: string;
  address: string;
  city: string;
  zipCode: string;
  email: string;
  phoneNumber: string;
  password: string;
  country: string;
}
