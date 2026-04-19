import test from "node:test";
import assert from "node:assert/strict";

import { getSseProxyQuery, requireApiInternalUrl } from "@/lib/sse-proxy";

test("getSseProxyQuery forwards only last_event_id", () => {
  const search = new URLSearchParams({
    last_event_id: "cursor-123",
    token: "secret",
    unexpected: "value",
  });

  assert.equal(getSseProxyQuery(search), "last_event_id=cursor-123");
});

test("getSseProxyQuery omits unknown params", () => {
  const search = new URLSearchParams({ foo: "bar" });
  assert.equal(getSseProxyQuery(search), "");
});

test("requireApiInternalUrl returns configured internal URL", () => {
  assert.equal(requireApiInternalUrl("http://api:3000"), "http://api:3000");
});

test("requireApiInternalUrl throws when missing", () => {
  assert.throws(
    () => requireApiInternalUrl(""),
    /API_INTERNAL_URL is required/,
  );
});
