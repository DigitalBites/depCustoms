import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { OsvConnectorConfig } from "../connectors/osv/config.js";
import { ContributorConnectorConfig } from "../connectors/contributor/config.js";
import { IntelligenceConnectorConfig } from "../connectors/intelligence/config.js";
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
  const contributor = new ContributorConnectorConfig();
  const intelligence = new IntelligenceConnectorConfig();

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
    {
      id: "contributor",
      name: "Contributor Risk",
      description:
        "Scores contributor and publisher change signals for supported package ecosystems.",
      enabled: contributor.enabled,
      homepage: null,
      config: {
        cacheTtlSeconds: contributor.cacheTtlSeconds,
        responseTimeoutMs: contributor.responseTimeoutMs,
        backgroundTimeoutMs: contributor.backgroundTimeoutMs,
      },
    },
    {
      id: "intelligence",
      name: "Package Intelligence",
      description:
        "Calls the internal intelligence service to detect likely typosquats and deceptive package names.",
      enabled: intelligence.enabled,
      homepage: null,
      config: {
        cacheTtlSeconds: intelligence.cacheTtlSeconds,
        responseTimeoutMs: intelligence.responseTimeoutMs,
        backgroundTimeoutMs: intelligence.backgroundTimeoutMs,
      },
    },
  ];

  return c.json({ connectors });
});
