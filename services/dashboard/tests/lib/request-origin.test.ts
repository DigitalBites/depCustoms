import test from "node:test";
import assert from "node:assert/strict";

import {
  isSameOriginRequest,
  resolveExpectedDashboardOrigin,
} from "@/lib/request-origin";

test("resolveExpectedDashboardOrigin uses PUBLIC_ORIGIN when configured", () => {
  assert.equal(
    resolveExpectedDashboardOrigin(
      "https://dashboard.example.com/auth/session",
      "https://app.example.com/some/path",
    ),
    "https://app.example.com",
  );
});

test("resolveExpectedDashboardOrigin falls back to request origin when PUBLIC_ORIGIN is unset", () => {
  assert.equal(
    resolveExpectedDashboardOrigin(
      "https://dashboard.example.com/auth/session",
      "",
    ),
    "https://dashboard.example.com",
  );
});

test("resolveExpectedDashboardOrigin uses forwarded host and proto when PUBLIC_ORIGIN is unset", () => {
  const headers = new Headers({
    "x-forwarded-host": "dashboard.example.com",
    "x-forwarded-proto": "https",
  });

  assert.equal(
    resolveExpectedDashboardOrigin(
      "https://dashboard-internal:3001/auth/session",
      "",
      headers,
    ),
    "https://dashboard.example.com",
  );
});

test("isSameOriginRequest accepts matching Origin header", () => {
  const request = new Request("https://dashboard.example.com/auth/session", {
    headers: { origin: "https://dashboard.example.com" },
  });

  assert.equal(isSameOriginRequest(request, ""), true);
});

test("isSameOriginRequest accepts matching Origin header behind a reverse proxy", () => {
  const request = new Request("https://dashboard-internal:3001/auth/session", {
    headers: {
      origin: "https://dashboard.example.com",
      "x-forwarded-host": "dashboard.example.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(isSameOriginRequest(request, ""), true);
});

test("isSameOriginRequest accepts matching Referer when Origin is absent", () => {
  const request = new Request("https://dashboard.example.com/auth/session", {
    headers: { referer: "https://dashboard.example.com/login" },
  });

  assert.equal(isSameOriginRequest(request, ""), true);
});

test("isSameOriginRequest rejects auth/API origins when they differ from dashboard origin", () => {
  const authRequest = new Request("https://dashboard.example.com/auth/session", {
    headers: { origin: "https://auth.example.com" },
  });
  const apiRequest = new Request("https://dashboard.example.com/auth/session", {
    headers: { origin: "https://api.example.com" },
  });

  assert.equal(isSameOriginRequest(authRequest, ""), false);
  assert.equal(isSameOriginRequest(apiRequest, ""), false);
});

test("isSameOriginRequest rejects requests without Origin or Referer", () => {
  const request = new Request("https://dashboard.example.com/auth/session");

  assert.equal(isSameOriginRequest(request, ""), false);
});
