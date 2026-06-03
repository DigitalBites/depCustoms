import test from "node:test";
import assert from "node:assert/strict";

import { fetchEnabledAuthProvidersWithDependencies } from "@/lib/auth-provider-settings";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

test("fetchEnabledAuthProvidersWithDependencies fetches Supabase auth settings with anon apikey", async () => {
  const requests: Array<{ url: string; apikey: string | null }> = [];

  const providers = await fetchEnabledAuthProvidersWithDependencies({
    authUrl: "https://auth.example.com",
    anonKey: "anon-key",
    fetchImpl: async (url, init) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url: String(url),
        apikey: headers.get("apikey"),
      });
      return jsonResponse({
        external: {
          github: true,
          google: false,
          gitlab: true,
        },
      });
    },
  });

  assert.deepEqual(requests, [
    {
      url: "https://auth.example.com/auth/v1/settings",
      apikey: "anon-key",
    },
  ]);
  assert.deepEqual(providers, [
    { id: "github", label: "GitHub", known: true },
    { id: "gitlab", label: "Gitlab", known: false },
  ]);
});

test("fetchEnabledAuthProvidersWithDependencies fails closed when settings request fails", async () => {
  assert.deepEqual(
    await fetchEnabledAuthProvidersWithDependencies({
      authUrl: "https://auth.example.com",
      anonKey: "anon-key",
      fetchImpl: async () => jsonResponse({}, { status: 500 }),
    }),
    [],
  );
});

test("fetchEnabledAuthProvidersWithDependencies fails closed when auth config is missing", async () => {
  assert.deepEqual(
    await fetchEnabledAuthProvidersWithDependencies({
      authUrl: "",
      anonKey: "anon-key",
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    }),
    [],
  );
});
