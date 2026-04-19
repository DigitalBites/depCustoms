import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { projectSecurityRouter } from "../features/security/project-routes.js";
import { tenantSecurityRouter } from "../features/security/tenant-routes.js";

export const securityRouter = new Hono();

securityRouter.use("*", authMiddleware);
securityRouter.route("/", projectSecurityRouter);
securityRouter.route("/", tenantSecurityRouter);
