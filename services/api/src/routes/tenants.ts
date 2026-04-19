import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { tenantCoreRouter } from "../features/tenants/core-routes.js";
import { tenantInviteRouter } from "../features/tenants/invite-routes.js";
import { tenantMemberRouter } from "../features/tenants/member-routes.js";

export const tenantsRouter = new Hono();

tenantsRouter.use("*", authMiddleware);
tenantsRouter.route("/", tenantCoreRouter);
tenantsRouter.route("/", tenantInviteRouter);
tenantsRouter.route("/", tenantMemberRouter);
