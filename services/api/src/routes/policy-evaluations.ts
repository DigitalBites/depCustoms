import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { policyEvaluationDetailRouter } from "../features/policy-evaluations/detail-routes.js";
import { projectPolicyEvaluationsRouter } from "../features/policy-evaluations/project-routes.js";

export const policyEvaluationsRouter = new Hono();
policyEvaluationsRouter.use("*", authMiddleware);
policyEvaluationsRouter.route("/", projectPolicyEvaluationsRouter);
policyEvaluationsRouter.route("/", policyEvaluationDetailRouter);
