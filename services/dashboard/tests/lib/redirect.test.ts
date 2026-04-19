import test from "node:test";
import assert from "node:assert/strict";

import { getSafeRedirectPath } from "@/lib/redirect";

test("getSafeRedirectPath accepts internal paths", () => {
  assert.equal(getSafeRedirectPath("/projects/123"), "/projects/123");
});

test("getSafeRedirectPath rejects absolute URLs", () => {
  assert.equal(
    getSafeRedirectPath("https://example.com/evil", "/projects"),
    "/projects",
  );
});

test("getSafeRedirectPath rejects protocol-relative URLs", () => {
  assert.equal(getSafeRedirectPath("//evil.test", "/projects"), "/projects");
});
