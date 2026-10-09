import cors from "cors";
import express, { Application, NextFunction, Request, Response } from "express";
import httpStatus from "http-status";
import globalErrorHandler from "./app/errors/globalErrorHandler";
import router from "./app/routes";
import path from "path";
import morgan from "morgan";
import { WebhookRoute } from "./app/modules/webhooks/webhook.route";
import { PaymentWebhookRoutes } from "./app/modules/payment/payment.webhook.route";

const app: Application = express();

// app.use(
//   cors({
//     origin: "*",
//     methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
//     allowedHeaders: ["Content-Type", "Authorization"],
//   })
// );

app.use(
  cors({
    origin: [
      "https://market-fusion-client.vercel.app",
      "https://market-fusion.vercel.app",
      "https://market-fusion-mart.vercel.app",
      "http://localhost:3000",
      // Extra origins without a code change, comma separated
      ...(process.env.CORS_ORIGINS?.split(",")
        .map((o) => o.trim().replace(/\/$/, ""))
        .filter(Boolean) ?? []),
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "ngrok-skip-browser-warning", // Keep for dev, harmless in production
    ],
    credentials: true,
  }),
);

app.use("/webhooks", WebhookRoute);

// Marketplace payment webhooks. Mounted here, ahead of express.json(), because
// Stripe checks its signature against the raw request bytes.
app.use("/api/v2/webhooks", PaymentWebhookRoutes);

//parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  "/uploads",
  express.static(path.join(__dirname, "..", "public", "uploads")),
);
console.log(path.join(__dirname, "..", "public", "uploads"));

app.get("/", (req: Request, res: Response) => {
  res.send({
    Message: "The Market Fusion server is running. . .",
  });
});

app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));
// app.use("/api/v1", router);
app.use("/api/v2", router);

app.use(globalErrorHandler);

app.use((req: Request, res: Response, next: NextFunction) => {
  res.status(httpStatus.NOT_FOUND).json({
    success: false,
    message: "API NOT FOUND!",
    error: {
      path: req.originalUrl,
      message: "Your requested path is not found!",
    },
  });
});

export default app;
