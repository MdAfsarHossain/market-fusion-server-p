import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { ServiceBookingService } from "./service.service";

// Free slots on a day - public
const availableSlots = catchAsync(async (req: Request, res: Response) => {
  const result = await ServiceBookingService.availableSlots(
    req.params.productId,
    req.query,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Slots fetched successfully",
    data: result,
  });
});

// My appointments - buyer
const myBookings = catchAsync(async (req: Request, res: Response) => {
  const result = await ServiceBookingService.myBookings(req.user.id, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bookings fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// The store diary - vendor
const vendorBookings = catchAsync(async (req: Request, res: Response) => {
  const result = await ServiceBookingService.vendorBookings(
    req.user.id,
    req.query,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Bookings fetched successfully",
    data: { summary: result.summary, bookings: result.data },
    meta: result.meta,
  });
});

// Drive the appointment forward - vendor
const updateBookingStatus = catchAsync(async (req: Request, res: Response) => {
  const result = await ServiceBookingService.updateBookingStatus(
    req.user.id,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking updated successfully",
    data: result,
  });
});

// Move an appointment - vendor
const rescheduleBooking = catchAsync(async (req: Request, res: Response) => {
  const result = await ServiceBookingService.rescheduleBooking(
    req.user.id,
    req.params.id,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Booking rescheduled successfully",
    data: result,
  });
});

// Weekly hours - vendor
const getAvailability = catchAsync(async (req: Request, res: Response) => {
  const result = await ServiceBookingService.getAvailability(
    req.user.id,
    req.params.productId,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Availability fetched successfully",
    data: result,
  });
});

const setAvailability = catchAsync(async (req: Request, res: Response) => {
  const result = await ServiceBookingService.setAvailability(
    req.user.id,
    req.params.productId,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Availability saved successfully",
    data: result,
  });
});

// Closures - vendor
const listTimeOff = catchAsync(async (req: Request, res: Response) => {
  const result = await ServiceBookingService.listTimeOff(req.user.id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Time off fetched successfully",
    data: result,
  });
});

const addTimeOff = catchAsync(async (req: Request, res: Response) => {
  const result = await ServiceBookingService.addTimeOff(req.user.id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Time off added successfully",
    data: result,
  });
});

const removeTimeOff = catchAsync(async (req: Request, res: Response) => {
  const result = await ServiceBookingService.removeTimeOff(
    req.user.id,
    req.params.id,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Time off removed successfully",
    data: result,
  });
});

export const ServiceController = {
  availableSlots,
  myBookings,
  vendorBookings,
  updateBookingStatus,
  rescheduleBooking,
  getAvailability,
  setAvailability,
  listTimeOff,
  addTimeOff,
  removeTimeOff,
};
