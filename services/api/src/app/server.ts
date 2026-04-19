import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import type { Hono } from "hono";
import type { PackageIntelligenceConnector } from "../connectors/types.js";
import { buildGatewayRoutes } from "../connect/gateway.js";
import { proxyJwtAuthInterceptor } from "../connect/proxy-auth.js";

export function createApiServer(
  app: Hono,
  connectors: PackageIntelligenceConnector[],
) {
  const connectHandler = connectNodeAdapter({
    routes: (router) => buildGatewayRoutes(router, connectors),
    interceptors: [proxyJwtAuthInterceptor()],
  });
  const honoListener = getRequestListener(app.fetch);

  return createServer((req, res) => {
    if (req.url?.startsWith("/customs.v1.")) {
      const xff = req.headers["x-forwarded-for"];
      const remoteAddr =
        (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() ??
        req.socket.remoteAddress ??
        "";
      req.headers["x-proxy-remote-addr"] = remoteAddr;
      connectHandler(req, res);
      return;
    }

    void honoListener(req, res);
  });
}
