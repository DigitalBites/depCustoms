import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { projectsRouter } from "../routes/projects.js";
import { tokensRouter } from "../routes/tokens.js";
import { eventsRouter } from "../routes/events.js";
import { sseRouter } from "../routes/sse.js";
import { policiesRouter } from "../routes/policies.js";
import { rulesRouter } from "../routes/rules.js";
import { policyAssignmentsRouter } from "../routes/policy-assignments.js";
import { fieldCatalogRouter } from "../features/field-catalog/routes.js";
import { policyPreviewRouter } from "../routes/policy-preview.js";
import { violationsRouter } from "../routes/violations.js";
import { violationSuppressionsRouter } from "../routes/violation-suppressions.js";
import { policyEvaluationsRouter } from "../routes/policy-evaluations.js";
import { proxiesRouter } from "../routes/proxies.js";
import { tenantsRouter } from "../routes/tenants.js";
import { packagesRouter } from "../routes/packages.js";
import { internalRouter } from "../routes/internal.js";
import { authRouter } from "../routes/auth.js";
import { securityRouter } from "../routes/security.js";
import { connectorsRouter } from "../features/connectors/routes.js";
import { performanceRouter } from "../features/performance/routes.js";
import { mcpRoutes } from "../routes/mcp.js";
import { oauthRoutes } from "../routes/oauth.js";
import { config } from "../config.js";
import { log, serializeError } from "../logger.js";
import { errorBody, errorJson } from "../http/responses.js";
import { checkDatabaseReadiness } from "./db-readiness.js";

export type ApiReadinessState = {
  dbReady: boolean;
};

export function buildApiApp(readiness: ApiReadinessState): Hono {
  const app = new Hono();
  const requestIdPattern = /^[a-zA-Z0-9_-]{1,64}$/;
  const routers = [
    internalRouter,
    oauthRoutes,
    authRouter,
    tenantsRouter,
    projectsRouter,
    tokensRouter,
    eventsRouter,
    sseRouter,
    policiesRouter,
    rulesRouter,
    policyAssignmentsRouter,
    fieldCatalogRouter,
    policyPreviewRouter,
    violationsRouter,
    violationSuppressionsRouter,
    policyEvaluationsRouter,
    proxiesRouter,
    packagesRouter,
    securityRouter,
    connectorsRouter,
    performanceRouter,
    mcpRoutes,
  ] as const;

  app.use(
    "*",
    bodyLimit({
      maxSize: config.requestBodyLimitBytes,
      onError: (c) =>
        c.json(
          errorBody(
            "PAYLOAD_TOO_LARGE",
            "Request body exceeds the configured size limit",
            null,
          ),
          413,
        ),
    }),
  );

  const corsOrigins = config.corsOrigins;
  app.use(
    "*",
    cors({
      origin: (origin) => (corsOrigins.includes(origin) ? origin : null),
      allowHeaders: [
        "Authorization",
        "Content-Type",
        "apikey",
        "X-Client-Info",
      ],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.use("*", async (c, next) => {
    const start = Date.now();
    const rawRequestId = c.req.header("x-request-id") ?? "";
    const requestId = requestIdPattern.test(rawRequestId)
      ? rawRequestId
      : Math.random().toString(36).slice(2);
    const clientIp = c.req.header("x-real-ip") ?? null;
    const forwardedFor = c.req.header("x-forwarded-for") ?? null;

    await next();

    log.info("request", {
      request_id: requestId,
      method: c.req.method,
      path: c.req.path,
      client_ip: clientIp,
      x_forwarded_for: forwardedFor,
      status: c.res.status,
      duration_ms: Date.now() - start,
    });
  });

  app.get("/healthz", async (c) => {
    if (!readiness.dbReady) {
      return c.json(
        { ok: false, status: "waiting_for_db", ts: new Date().toISOString() },
        503,
      );
    }

    try {
      const readinessCheck = await checkDatabaseReadiness();
      if (!readinessCheck.ok) {
        return c.json(
          {
            ok: false,
            status: "schema_not_ready",
            missing_tables: readinessCheck.missingTables,
            ts: new Date().toISOString(),
          },
          503,
        );
      }
      return c.json({ ok: true, ts: new Date().toISOString() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error("healthz_failed", { ...serializeError(err) });
      return c.json(
        {
          ok: false,
          error:
            config.environment === "development"
              ? message
              : "Database unavailable",
          ts: new Date().toISOString(),
        },
        503,
      );
    }
  });

  for (const router of routers) {
    app.route("/", router);
  }

  app.onError((err, c) => {
    log.error("unhandled_error", { ...serializeError(err) });

    return errorJson(
      c,
      500,
      "INTERNAL_ERROR",
      "An unexpected error occurred",
      config.environment === "development" ? err.message : null,
    );
  });

  app.notFound((c) =>
    errorJson(c, 404, "NOT_FOUND", "Route not found", c.req.path),
  );

  return app;
}
