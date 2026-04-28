import { describe, expect, it } from "vitest";
import {
  buildOpenApiApp,
  openApiDocumentConfig,
} from "../../openapi/app.js";

describe("OpenAPI export", () => {
  it("includes bootstrap and project token paths", () => {
    const app = buildOpenApiApp();
    const doc = app.getOpenAPI31Document(openApiDocumentConfig);

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths).toHaveProperty("/internal/bootstrap/status");
    expect(doc.paths).toHaveProperty("/internal/bootstrap/status/detail");
    expect(doc.paths).toHaveProperty("/internal/bootstrap/first-user");
    expect(doc.paths).toHaveProperty("/v1/projects/{project_id}/tokens");
    expect(doc.paths).toHaveProperty(
      "/v1/projects/{project_id}/tokens/{token_id}",
    );
    expect(doc.paths).toHaveProperty(
      "/v1/projects/{project_id}/tokens/{token_id}/rotate",
    );
    expect(doc.info.title).toBe("Customs API");
  });
});
