import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveBrowserPublicRuntimeConfig,
  type PublicRuntimeConfig,
} from "@/lib/public-runtime-config";

test("resolveBrowserPublicRuntimeConfig uses the browser origin for auth and API when same-origin proxies are enabled", () => {
  const config: PublicRuntimeConfig = {
    authUrl: "http://localhost:3001",
    anonKey: "anon",
    apiUrl: "http://localhost:3001",
    authProxyEnabled: true,
    apiProxyEnabled: true,
  };

  assert.deepEqual(
    resolveBrowserPublicRuntimeConfig(config, "http://localhost"),
    {
      ...config,
      authUrl: "http://localhost",
      apiUrl: "http://localhost",
    },
  );
});

test("resolveBrowserPublicRuntimeConfig preserves explicit cross-origin endpoints when same-origin proxies are disabled", () => {
  const config: PublicRuntimeConfig = {
    authUrl: "https://auth.example.com",
    anonKey: "anon",
    apiUrl: "https://api.example.com",
    authProxyEnabled: false,
    apiProxyEnabled: false,
  };

  assert.deepEqual(
    resolveBrowserPublicRuntimeConfig(config, "https://dashboard.example.com"),
    config,
  );
});
