import test from "node:test";
import assert from "node:assert/strict";

import { buildContentSecurityPolicy } from "@/lib/csp";

test("production CSP limits connect-src to explicit configured origins", () => {
  const csp = buildContentSecurityPolicy(true, {
    apiUrl: "https://api.customs.test",
    authUrl: "https://auth.customs.test",
  });

  assert.match(
    csp,
    /connect-src 'self' https:\/\/api\.customs\.test https:\/\/auth\.customs\.test/,
  );
  assert.doesNotMatch(csp, /connect-src 'self' http: https:/);
});

test("production CSP ignores malformed configured origins", () => {
  const csp = buildContentSecurityPolicy(true, {
    apiUrl: "not-a-url",
  });

  assert.match(csp, /connect-src 'self'/);
  assert.doesNotMatch(csp, /not-a-url/);
});

test("development CSP keeps broader connect-src and unsafe-eval", () => {
  const csp = buildContentSecurityPolicy(false);

  assert.match(csp, /connect-src 'self' http: https:/);
  assert.match(csp, /script-src 'self' blob: 'unsafe-inline' 'unsafe-eval'/);
});
