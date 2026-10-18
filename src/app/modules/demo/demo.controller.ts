import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../helpers/catchAsync";
import sendResponse from "../../helpers/sendResponse";
import { DemoService } from "./demo.service";

// Sign in to a read-only demo account, no credentials needed
const demoLogin = catchAsync(async (req: Request, res: Response) => {
  const result = await DemoService.demoLogin(req.body.role);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Signed in to the demo account",
    data: result,
  });
});

export const DemoController = { demoLogin };
