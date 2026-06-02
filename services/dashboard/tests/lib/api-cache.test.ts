import test from "node:test";
import assert from "node:assert/strict";

import { getApiFetchCachePartition } from "@/lib/api-cache";

function makeToken(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.`;
}

test("getApiFetchCachePartition separates tenants and tokens", () => {
  const tokenA = makeToken({
    app_metadata: {
      tenant_id: "tenant_a",
      role: "owner",
    },
  });
  const tokenB = makeToken({
    app_metadata: {
      tenant_id: "tenant_b",
      role: "owner",
    },
  });
  const rotatedTokenA = makeToken({
    app_metadata: {
      tenant_id: "tenant_a",
      role: "owner",
    },
    exp: 123,
  });

  assert.notEqual(
    getApiFetchCachePartition(tokenA),
    getApiFetchCachePartition(tokenB),
  );
  assert.notEqual(
    getApiFetchCachePartition(tokenA),
    getApiFetchCachePartition(rotatedTokenA),
  );
});
