import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantPoliciesRouter } from "../features/policies/tenant-routes.js";
import { projectPoliciesRouter } from "../features/policies/project-routes.js";
import { policyDetailRouter } from "../features/policies/detail-routes.js";

export const policiesRouter = new Hono();

policiesRouter.use("*", authMiddleware);
policiesRouter.route("/", tenantPoliciesRouter);
policiesRouter.route("/", projectPoliciesRouter);
policiesRouter.route("/", policyDetailRouter);
