import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

process.env.INTERNAL_SERVICE_JWT_PRIVATE_JWK ||= '{"kty":"oct","k":"test"}';

const { buildOpenApiApp, openApiDocumentConfig } = await import(
  "../src/openapi/app.js"
);

const outputPath = resolve(process.cwd(), "docs/openapi.json");
mkdirSync(dirname(outputPath), { recursive: true });

const app = buildOpenApiApp();
const document = app.getOpenAPI31Document(openApiDocumentConfig);
writeFileSync(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

console.log(outputPath);
