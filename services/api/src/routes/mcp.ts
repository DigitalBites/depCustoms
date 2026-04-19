import { Hono } from "hono";
import { mcpRouter } from "../features/mcp/router.js";

export const mcpRoutes = new Hono();

mcpRoutes.route("/", mcpRouter);
