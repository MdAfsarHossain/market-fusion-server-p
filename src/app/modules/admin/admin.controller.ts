import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import { AdminService } from "./admin.service";
import httpStatus from "http-status";
// import { AdminService } from "./admin.service";

// All KYC Documents List Controller
const getAllKYCDocuments = catchAsync(async (req: Request, res: Response) => {
  const pagination = req.query;

  const result = await AdminService.getAllKYCDocuments(pagination);

  res.status(httpStatus.OK).json({
    success: true,
    statusCode: httpStatus.OK,
    message: "KYC Documents List",
    data: result.data,
    meta: result.meta,
  });
});

export const AdminController = {
  getAllKYCDocuments,
};
