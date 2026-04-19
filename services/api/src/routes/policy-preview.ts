import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { policyPreviewPolicyRouter } from "../features/policy-preview/policy-routes.js";
import { policyPreviewProjectRouter } from "../features/policy-preview/project-routes.js";

export const policyPreviewRouter = new Hono();
policyPreviewRouter.use("*", authMiddleware);
policyPreviewRouter.route("/", policyPreviewPolicyRouter);
policyPreviewRouter.route("/", policyPreviewProjectRouter);
