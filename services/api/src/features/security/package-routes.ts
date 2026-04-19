import { Hono } from "hono";
import { projectSecurityPackageLegacyRouter } from "./package-legacy-routes.js";
import { projectSecurityPackageListRouter } from "./package-list-routes.js";
import { projectSecurityPackageSummaryRouter } from "./package-summary-routes.js";

export const projectSecurityPackageRouter = new Hono();
projectSecurityPackageRouter.route("/", projectSecurityPackageSummaryRouter);
projectSecurityPackageRouter.route("/", projectSecurityPackageListRouter);
projectSecurityPackageRouter.route("/", projectSecurityPackageLegacyRouter);
