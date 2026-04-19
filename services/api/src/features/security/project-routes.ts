import { Hono } from "hono";
import { projectSecurityConnectorRouter } from "./connector-routes.js";
import { projectSecurityFindingsRouter } from "./findings-routes.js";
import { projectSecurityPackageRouter } from "./package-routes.js";
import { projectSecuritySummaryRouter } from "./summary-routes.js";
import { projectContributorPackageListRouter } from "./contributor-package-list-routes.js";
import { contributorSummaryRouter } from "./contributor-summary-routes.js";
import { projectSecurityFindingPackageRouter } from "./finding-package-routes.js";

export const projectSecurityRouter = new Hono();
projectSecurityRouter.route("/", projectSecuritySummaryRouter);
projectSecurityRouter.route("/", projectSecurityFindingsRouter);
projectSecurityRouter.route("/", projectSecurityFindingPackageRouter);
projectSecurityRouter.route("/", projectSecurityConnectorRouter);
projectSecurityRouter.route("/", projectSecurityPackageRouter);
projectSecurityRouter.route("/", projectContributorPackageListRouter);
projectSecurityRouter.route("/", contributorSummaryRouter);
