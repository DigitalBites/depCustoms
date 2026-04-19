import { Hono } from "hono";
import { projectRoutes } from "../features/projects/routes.js";
import { authMiddleware } from "../middleware/auth.js";

export const projectsRouter = new Hono();
projectsRouter.use("*", authMiddleware);
projectsRouter.route("/", projectRoutes);
