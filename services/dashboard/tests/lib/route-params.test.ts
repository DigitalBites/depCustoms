import test from "node:test";
import assert from "node:assert/strict";

import { getValidUuidParam } from "@/lib/route-params";

test("getValidUuidParam accepts UUID values", () => {
  assert.equal(
    getValidUuidParam("550e8400-e29b-41d4-a716-446655440000"),
    "550e8400-e29b-41d4-a716-446655440000",
  );
});

test("getValidUuidParam rejects malformed values", () => {
  assert.equal(getValidUuidParam("not-a-uuid"), null);
  assert.equal(getValidUuidParam("../escape"), null);
  assert.equal(getValidUuidParam(""), null);
});
