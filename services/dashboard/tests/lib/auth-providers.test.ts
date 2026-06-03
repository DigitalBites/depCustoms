import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAuthProvidersFromSettingsExternal,
  getProviderFallbackLabel,
} from "@/lib/auth-providers";

test("buildAuthProvidersFromSettingsExternal returns enabled providers with known providers sorted first", () => {
  assert.deepEqual(
    buildAuthProvidersFromSettingsExternal({
      email: true,
      phone: true,
      unknown_provider: true,
      google: true,
      github: true,
      disabled: false,
    }),
    [
      { id: "github", label: "GitHub", known: true },
      { id: "google", label: "Google", known: true },
      {
        id: "unknown_provider",
        label: "Unknown Provider",
        known: false,
      },
    ],
  );
});

test("buildAuthProvidersFromSettingsExternal excludes Supabase non-OAuth auth methods", () => {
  assert.deepEqual(
    buildAuthProvidersFromSettingsExternal({
      anonymous: true,
      email: true,
      phone: true,
      saml: true,
      sms: true,
      sso: true,
      github: true,
    }),
    [{ id: "github", label: "GitHub", known: true }],
  );
});

test("buildAuthProvidersFromSettingsExternal fails closed for malformed settings", () => {
  assert.deepEqual(buildAuthProvidersFromSettingsExternal(null), []);
  assert.deepEqual(buildAuthProvidersFromSettingsExternal([]), []);
  assert.deepEqual(buildAuthProvidersFromSettingsExternal("github"), []);
});

test("buildAuthProvidersFromSettingsExternal ignores unsafe provider keys", () => {
  const tooLongProvider = "x".repeat(65);
  assert.deepEqual(
    buildAuthProvidersFromSettingsExternal({
      github: true,
      "../evil": true,
      "bad provider": true,
      [tooLongProvider]: true,
    }),
    [{ id: "github", label: "GitHub", known: true }],
  );
});

test("getProviderFallbackLabel formats unknown provider identifiers", () => {
  assert.equal(getProviderFallbackLabel("azure_ad"), "Azure Ad");
  assert.equal(getProviderFallbackLabel("gitlab"), "Gitlab");
});
