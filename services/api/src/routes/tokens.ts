import { OpenAPIHono } from "@hono/zod-openapi";
import { tokenRoutes } from "../features/tokens/routes.js";
import { authMiddleware } from "../middleware/auth.js";

export const tokensRouter = new OpenAPIHono();
tokensRouter.use("*", authMiddleware);
tokensRouter.route("/", tokenRoutes);
