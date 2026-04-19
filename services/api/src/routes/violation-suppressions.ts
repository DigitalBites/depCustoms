import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { projectViolationSuppressionRouter } from "../features/violation-suppressions/project-routes.js";
import { tenantViolationSuppressionRouter } from "../features/violation-suppressions/tenant-routes.js";
import { violationSuppressionWriteRouter } from "../features/violation-suppressions/write-routes.js";

export const violationSuppressionsRouter = new Hono();
violationSuppressionsRouter.use("*", authMiddleware);
violationSuppressionsRouter.route("/", violationSuppressionWriteRouter);
violationSuppressionsRouter.route("/", projectViolationSuppressionRouter);
violationSuppressionsRouter.route("/", tenantViolationSuppressionRouter);
