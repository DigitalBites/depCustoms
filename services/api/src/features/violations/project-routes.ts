import { Hono } from "hono";
import { projectViolationDetailRouter } from "./project-detail-routes.js";
import { projectViolationEntityRouter } from "./entity-routes.js";
import { projectViolationListRouter } from "./project-list-routes.js";

export const projectViolationsRouter = new Hono();
projectViolationsRouter.route("/", projectViolationEntityRouter);
projectViolationsRouter.route("/", projectViolationListRouter);
projectViolationsRouter.route("/", projectViolationDetailRouter);
