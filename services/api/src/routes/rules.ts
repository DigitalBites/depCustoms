import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { policyRulesRouter } from "../features/rules/policy-routes.js";
import { ruleDetailRouter } from "../features/rules/detail-routes.js";

export const rulesRouter = new Hono();
rulesRouter.use("*", authMiddleware);
rulesRouter.route("/", policyRulesRouter);
rulesRouter.route("/", ruleDetailRouter);
