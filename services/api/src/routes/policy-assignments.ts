import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { policyBindingDetailRouter } from "../features/policy-assignments/assignment-routes.js";
import { policyBindingsPolicyRouter } from "../features/policy-assignments/policy-routes.js";
import { policyBindingsProjectRouter } from "../features/policy-assignments/project-routes.js";

export const policyBindingsRouter = new Hono();
policyBindingsRouter.use("*", authMiddleware);
policyBindingsRouter.route("/", policyBindingsPolicyRouter);
policyBindingsRouter.route("/", policyBindingDetailRouter);
policyBindingsRouter.route("/", policyBindingsProjectRouter);

export const policyAssignmentsRouter = policyBindingsRouter;
