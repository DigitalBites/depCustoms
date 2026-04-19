import { Hono } from "hono";
import { proxyRoutes } from "../features/proxies/routes.js";
import { authMiddleware } from "../middleware/auth.js";

export const proxiesRouter = new Hono();
proxiesRouter.use("*", authMiddleware);
proxiesRouter.route("/", proxyRoutes);
