import httpStatus from "http-status";
import { Request, Response } from "express";
import sendResponse from "../../helpers/sendResponse";
import { HealthService } from "./health.service";

// Liveness plus a real database round trip.
//
// Not wrapped in catchAsync on purpose. This endpoint is public so that an
// external scheduler can reach it, and the global error handler answers with the
// driver's own message and a stack trace — which for a database failure means
// handing anyone who asks the Supabase project ref and server file paths. The
// failure is caught here instead and reported as a bare 503.
const health = async (req: Request, res: Response) => {
  try {
    const result = await HealthService.pingDatabase();

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Service healthy",
      data: {
        status: "ok",
        uptime_seconds: Math.round(process.uptime()),
        // null until the daily cron has fired on this instance, so it is a
        // real signal rather than an echo of this very request
        last_cron_ping: HealthService.getLastCronPing(),
        ...result,
      },
    });
  } catch (error: any) {
    // The detail stays in the server log, where it is useful and private
    console.error("Health check failed:", error?.message);

    res.status(httpStatus.SERVICE_UNAVAILABLE).json({
      success: false,
      message: "Database unreachable",
      data: {
        status: "degraded",
        uptime_seconds: Math.round(process.uptime()),
        database: "unreachable",
      },
    });
  }
};

export const HealthController = { health };
