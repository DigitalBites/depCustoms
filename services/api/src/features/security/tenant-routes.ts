import { Hono } from "hono";
import { tenantSecurityPackageRouter } from "./tenant-package-routes.js";
import { tenantContributorPackageListRouter } from "./tenant-contributor-package-routes.js";
import { tenantSecuritySummaryRouter } from "./tenant-summary-routes.js";
import { tenantSecurityPageSummaryRouter } from "./tenant-security-summary-routes.js";
import { contributorSummaryRouter } from "./contributor-summary-routes.js";
import { contributorPublisherRouter } from "./contributor-publisher-routes.js";
import { tenantSecurityFindingPackageRouter } from "./finding-package-routes.js";

export const tenantSecurityRouter = new Hono();
tenantSecurityRouter.route("/", tenantSecuritySummaryRouter);
tenantSecurityRouter.route("/", tenantSecurityPageSummaryRouter);
tenantSecurityRouter.route("/", tenantSecurityFindingPackageRouter);
tenantSecurityRouter.route("/", tenantSecurityPackageRouter);
tenantSecurityRouter.route("/", tenantContributorPackageListRouter);
tenantSecurityRouter.route("/", contributorSummaryRouter);
tenantSecurityRouter.route("/", contributorPublisherRouter);
