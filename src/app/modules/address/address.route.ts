import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { AddressController } from "./address.controller";
import { AddressValidation } from "./address.validation";
const route = Router();

route.get("/my-addresses", auth(), AddressController.myAddresses);

route.post(
  "/create",
  auth(),
  validateRequest(AddressValidation.createAddress),
  AddressController.createAddress,
);

route.patch(
  "/update/:id",
  auth(),
  validateRequest(AddressValidation.updateAddress),
  AddressController.updateAddress,
);

route.delete("/delete/:id", auth(), AddressController.deleteAddress);

export const AddressRoutes = route;
