import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { projectViolationsRouter } from "../features/violations/project-routes.js";
import { tenantViolationsRouter } from "../features/violations/tenant-routes.js";

export { enrichViolations } from "../features/violations/enrichment.js";

export const violationsRouter = new Hono();

violationsRouter.use("*", authMiddleware);
violationsRouter.route("/", projectViolationsRouter);
violationsRouter.route("/", tenantViolationsRouter);
