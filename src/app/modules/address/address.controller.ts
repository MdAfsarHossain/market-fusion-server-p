import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { AddressService } from "./address.service";

// Create address
const createAddress = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await AddressService.createAddress(userId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Address created successfully",
    data: result,
  });
});

// My addresses
const myAddresses = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await AddressService.myAddresses(userId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Addresses fetched successfully",
    data: result,
  });
});

// Update address
const updateAddress = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { id } = req.params;
  const result = await AddressService.updateAddress(userId, id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Address updated successfully",
    data: result,
  });
});

// Delete address
const deleteAddress = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { id } = req.params;
  const result = await AddressService.deleteAddress(userId, id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Address deleted successfully",
    data: result,
  });
});

export const AddressController = {
  createAddress,
  myAddresses,
  updateAddress,
  deleteAddress,
};
