import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { RentalService } from "./rental.service";

// Is this window free - public
const availability = catchAsync(async (req: Request, res: Response) => {
  const result = await RentalService.availability(
    req.params.productId,
    req.query,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Availability fetched successfully",
    data: result,
  });
});

// Which windows are taken - public, for a calendar
const bookedWindows = catchAsync(async (req: Request, res: Response) => {
  const result = await RentalService.bookedWindows(
    req.params.productId,
    req.query,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booked windows fetched successfully",
    data: result,
  });
});

// My rentals - buyer
const myBookings = catchAsync(async (req: Request, res: Response) => {
  const result = await RentalService.myBookings(req.user.id, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Rentals fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// The store's rental diary - vendor
const vendorBookings = catchAsync(async (req: Request, res: Response) => {
  const result = await RentalService.vendorBookings(req.user.id, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Rentals fetched successfully",
    data: { summary: result.summary, bookings: result.data },
    meta: result.meta,
  });
});

// Item handed over - vendor
const markPickedUp = catchAsync(async (req: Request, res: Response) => {
  const result = await RentalService.markPickedUp(
    req.user.id,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Rental marked as collected",
    data: result,
  });
});

// Item back, deposit settled - vendor
const markReturned = catchAsync(async (req: Request, res: Response) => {
  const result = await RentalService.markReturned(
    req.user.id,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Rental returned and deposit settled",
    data: result,
  });
});

export const RentalController = {
  availability,
  bookedWindows,
  myBookings,
  vendorBookings,
  markPickedUp,
  markReturned,
};
