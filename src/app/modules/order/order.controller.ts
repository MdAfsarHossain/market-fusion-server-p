import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { OrderService } from "./order.service";

// Checkout - place an order from the cart
const checkout = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await OrderService.checkout(userId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Order placed successfully. Please complete the payment.",
    data: result,
  });
});

// My orders
const myOrders = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await OrderService.myOrders(userId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Orders fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// Single order - buyer
const myOrder = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { id } = req.params;
  const result = await OrderService.myOrder(userId, id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Order fetched successfully",
    data: result,
  });
});

// Cancel order - buyer
const cancelMyOrder = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { id } = req.params;
  const result = await OrderService.cancelMyOrder(userId, id, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Order cancelled successfully",
    data: result,
  });
});

// Vendor orders
const vendorOrders = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await OrderService.vendorOrders(userId, req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Orders fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// Single sub order - vendor
const vendorOrder = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { subOrderId } = req.params;
  const result = await OrderService.vendorOrder(userId, subOrderId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Order fetched successfully",
    data: result,
  });
});

// Update sub order status - vendor
const updateSubOrderStatus = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { subOrderId } = req.params;
  const result = await OrderService.updateSubOrderStatus(
    userId,
    subOrderId,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Order status updated successfully",
    data: result,
  });
});

// All orders - admin
const allOrdersForAdmin = catchAsync(async (req: Request, res: Response) => {
  const result = await OrderService.allOrdersForAdmin(req.query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Orders fetched successfully",
    data: result.data,
    meta: result.meta,
  });
});

// Single order - admin
const orderForAdmin = catchAsync(async (req: Request, res: Response) => {
  const { id } = req.params;
  const result = await OrderService.orderForAdmin(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Order fetched successfully",
    data: result,
  });
});

export const OrderController = {
  checkout,
  myOrders,
  myOrder,
  cancelMyOrder,
  vendorOrders,
  vendorOrder,
  updateSubOrderStatus,
  allOrdersForAdmin,
  orderForAdmin,
};
