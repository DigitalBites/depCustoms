import { Hono } from "hono";
import { tokenRoutes } from "../features/tokens/routes.js";
import { authMiddleware } from "../middleware/auth.js";

export const tokensRouter = new Hono();
tokensRouter.use("*", authMiddleware);
tokensRouter.route("/", tokenRoutes);
