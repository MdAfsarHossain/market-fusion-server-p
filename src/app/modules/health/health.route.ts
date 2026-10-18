import { Router } from "express";
import { HealthController } from "./health.controller";
const route = Router();

// Deliberately unauthenticated: an external scheduler (cron-job.org, GitHub
// Actions, an uptime monitor) has to be able to call this to keep the Supabase
// project awake when this process is not running to fire its own cron.
route.get("/", HealthController.health);

export const HealthRoutes = route;
