import { OpenAPIHono } from "@hono/zod-openapi";
import { internalRouter } from "../routes/internal.js";
import { tokensRouter } from "../routes/tokens.js";

export function buildOpenApiApp() {
  const app = new OpenAPIHono();
  app.route("/", internalRouter);
  app.route("/", tokensRouter);
  return app;
}

export const openApiDocumentConfig = {
  openapi: "3.1.0" as const,
  info: {
    title: "Customs API",
    version: "0.1.0",
    description:
      "Partial REST API contract for bootstrap and project token endpoints.",
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
  },
};
