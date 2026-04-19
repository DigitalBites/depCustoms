import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { policyAssignmentDetailRouter } from "../features/policy-assignments/assignment-routes.js";
import { policyAssignmentsPolicyRouter } from "../features/policy-assignments/policy-routes.js";
import { policyAssignmentsProjectRouter } from "../features/policy-assignments/project-routes.js";

export const policyAssignmentsRouter = new Hono();
policyAssignmentsRouter.use("*", authMiddleware);
policyAssignmentsRouter.route("/", policyAssignmentsPolicyRouter);
policyAssignmentsRouter.route("/", policyAssignmentDetailRouter);
policyAssignmentsRouter.route("/", policyAssignmentsProjectRouter);
