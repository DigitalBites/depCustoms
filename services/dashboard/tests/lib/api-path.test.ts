import test from "node:test";
import assert from "node:assert/strict";

import { assertRelativeApiPath, buildApiUrl } from "@/lib/api-path";

test("assertRelativeApiPath accepts relative API paths", () => {
  assert.doesNotThrow(() => assertRelativeApiPath("/v1/projects"));
});

test("assertRelativeApiPath rejects absolute URLs", () => {
  assert.throws(
    () => assertRelativeApiPath("https://example.com/v1/projects"),
    /relative API paths/,
  );
});

test("buildApiUrl joins base URL and relative path", () => {
  assert.equal(
    buildApiUrl("http://localhost:3001", "/v1/projects"),
    "http://localhost:3001/v1/projects",
  );
});
