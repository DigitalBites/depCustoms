import test from "node:test";
import assert from "node:assert/strict";

import { parseAccessTokenMetadata } from "@/lib/jwt-metadata";

function makeToken(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

test("parseAccessTokenMetadata extracts tenant metadata", () => {
  const token = makeToken({
    app_metadata: {
      tenant_id: "tenant_123",
      role: "owner",
      tenants: [
        { tenant_id: "tenant_123", tenant_name: "Main", role: "owner" },
      ],
    },
  });

  assert.deepEqual(parseAccessTokenMetadata(token), {
    tenantId: "tenant_123",
    role: "owner",
    tenants: [
      { tenant_id: "tenant_123", tenant_name: "Main", role: "owner" },
    ],
  });
});

test("parseAccessTokenMetadata filters malformed tenants", () => {
  const token = makeToken({
    app_metadata: {
      tenant_id: "tenant_123",
      role: "owner",
      tenants: [
        { tenant_id: "tenant_123", tenant_name: "Main", role: "owner" },
        { tenant_id: "tenant_456", tenant_name: "Missing role" },
      ],
    },
  });

  assert.deepEqual(parseAccessTokenMetadata(token), {
    tenantId: "tenant_123",
    role: "owner",
    tenants: [
      { tenant_id: "tenant_123", tenant_name: "Main", role: "owner" },
    ],
  });
});

test("parseAccessTokenMetadata returns null for malformed tokens", () => {
  assert.equal(parseAccessTokenMetadata("not-a-jwt"), null);
});

test("parseAccessTokenMetadata drops invalid role values", () => {
  const token = makeToken({
    app_metadata: {
      tenant_id: "tenant_123",
      role: "superadmin",
      tenants: [
        { tenant_id: "tenant_123", tenant_name: "Main", role: "superadmin" },
      ],
    },
  });

  assert.deepEqual(parseAccessTokenMetadata(token), {
    tenantId: "tenant_123",
    role: undefined,
    tenants: [],
  });
});
