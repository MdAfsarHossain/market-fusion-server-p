import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { CartController } from "./cart.controller";
import { CartValidation } from "./cart.validation";
const route = Router();

route.get("/", auth(), CartController.myCart);

route.post(
  "/add",
  auth(),
  validateRequest(CartValidation.addToCart),
  CartController.addToCart,
);

route.patch(
  "/item/:itemId",
  auth(),
  validateRequest(CartValidation.updateCartItem),
  CartController.updateCartItem,
);

route.delete("/item/:itemId", auth(), CartController.removeCartItem);

route.delete("/clear", auth(), CartController.clearCart);

export const CartRoutes = route;
