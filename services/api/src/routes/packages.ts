import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { projectPackagesRouter } from "../features/packages/project-routes.js";
import { tenantPackagesRouter } from "../features/packages/tenant-routes.js";
import { packageRebuildRouter } from "../features/packages/rebuild-routes.js";

export const packagesRouter = new Hono();
packagesRouter.use("*", authMiddleware);
packagesRouter.route("/", projectPackagesRouter);
packagesRouter.route("/", tenantPackagesRouter);
packagesRouter.route("/", packageRebuildRouter);
