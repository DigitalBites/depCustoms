import { Hono } from "hono";
import { tenantViolationEntityRouter } from "./entity-routes.js";
import { tenantViolationListRouter } from "./tenant-list-routes.js";
import { tenantViolationSummaryRouter } from "./tenant-summary-routes.js";

export const tenantViolationsRouter = new Hono();
tenantViolationsRouter.route("/", tenantViolationSummaryRouter);
tenantViolationsRouter.route("/", tenantViolationEntityRouter);
tenantViolationsRouter.route("/", tenantViolationListRouter);
