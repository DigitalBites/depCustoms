import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { projectEventsRouter } from "../features/events/project-routes.js";
import { tenantEventsRouter } from "../features/events/tenant-routes.js";

export const eventsRouter = new Hono();

eventsRouter.use("*", authMiddleware);
eventsRouter.route("/", tenantEventsRouter);
eventsRouter.route("/", projectEventsRouter);
