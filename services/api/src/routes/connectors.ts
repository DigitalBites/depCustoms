import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { OsvConnectorConfig } from "../connectors/osv/config.js";
import { requireTenantCapability } from "../http/guards.js";

export const connectorsRouter = new Hono();

connectorsRouter.use("*", authMiddleware);

// GET /v1/connectors — list configured connectors and their status
//
// Each connector config class owns its env var reading; this route
// instantiates them to get current values (cheap — env reads only).
// Intentionally read-only — connector configuration is managed via
// environment variables, not the database.
connectorsRouter.get("/v1/connectors", async (c) => {
  if (!requireTenantCapability(c, "connectors.read", "Access denied")) {
    return c.res;
  }

  const osv = new OsvConnectorConfig();

  const connectors = [
    {
      id: "osv",
      name: "OSV (Open Source Vulnerabilities)",
      description:
        "Queries api.osv.dev for CVE and advisory data across open-source ecosystems. " +
        "Covers npm, PyPI, Go, Rust, Maven, and many more.",
      enabled: osv.enabled,
      homepage: "https://osv.dev",
      config: {
        cacheTtlSeconds: osv.cacheTtlSeconds,
        responseTimeoutMs: osv.responseTimeoutMs,
        backgroundTimeoutMs: osv.backgroundTimeoutMs,
      },
    },
  ];

  return c.json({ connectors });
});
