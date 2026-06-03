import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDashboardUrl,
  getDashboardOrigin,
  getOAuthCallbackExchangeAuthUrl,
} from "@/lib/dashboard-origin";

test("getDashboardOrigin uses PUBLIC_ORIGIN for browser redirects", () => {
  const request = new Request("https://dashboard-internal:3001/auth/callback", {
    headers: {
      "x-forwarded-host": "wrong.example.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(
    getDashboardOrigin(request, "https://demo.depcustoms.com"),
    "https://demo.depcustoms.com",
  );
});

test("getDashboardOrigin uses forwarded origin when PUBLIC_ORIGIN is unset", () => {
  const request = new Request("https://dashboard-internal:3001/auth/callback", {
    headers: {
      "x-forwarded-host": "demo.depcustoms.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(getDashboardOrigin(request, ""), "https://demo.depcustoms.com");
});

test("buildDashboardUrl builds public callback redirects from internal request URLs", () => {
  const request = new Request("https://dashboard-internal:3001/auth/callback", {
    headers: {
      "x-forwarded-host": "demo.depcustoms.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(
    buildDashboardUrl(request, "/login?error=auth_failed", "").toString(),
    "https://demo.depcustoms.com/login?error=auth_failed",
  );
});

test("getOAuthCallbackExchangeAuthUrl uses the browser auth origin when auth proxying is enabled", () => {
  const request = new Request("https://dashboard-internal:3001/auth/callback", {
    headers: {
      "x-forwarded-host": "demo.depcustoms.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(
    getOAuthCallbackExchangeAuthUrl(
      request,
      true,
      "https://lgnzvtkzjsidqtblcclg.supabase.co/auth/v1",
      "",
    ),
    "https://demo.depcustoms.com",
  );
});

test("getOAuthCallbackExchangeAuthUrl uses the configured auth URL when auth proxying is disabled", () => {
  const request = new Request("https://dashboard-internal:3001/auth/callback", {
    headers: {
      "x-forwarded-host": "demo.depcustoms.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(
    getOAuthCallbackExchangeAuthUrl(
      request,
      false,
      "https://lgnzvtkzjsidqtblcclg.supabase.co/auth/v1",
      "",
    ),
    "https://lgnzvtkzjsidqtblcclg.supabase.co/auth/v1",
  );
});
