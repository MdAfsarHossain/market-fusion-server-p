import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { CartService } from "./cart.service";

// Add to cart
const addToCart = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await CartService.addToCart(userId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Item added to cart successfully",
    data: result,
  });
});

// My cart
const myCart = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await CartService.myCart(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Cart fetched successfully",
    data: result,
  });
});

// Update cart item quantity
const updateCartItem = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { itemId } = req.params;
  const result = await CartService.updateCartItem(userId, itemId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Cart item updated successfully",
    data: result,
  });
});

// Remove a cart item
const removeCartItem = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const { itemId } = req.params;
  const result = await CartService.removeCartItem(userId, itemId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Cart item removed successfully",
    data: result,
  });
});

// Clear cart
const clearCart = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await CartService.clearCart(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Cart cleared successfully",
    data: result,
  });
});

export const CartController = {
  addToCart,
  myCart,
  updateCartItem,
  removeCartItem,
  clearCart,
};
