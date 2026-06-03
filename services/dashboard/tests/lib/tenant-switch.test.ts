import test from "node:test";
import assert from "node:assert/strict";

import { switchTenantWithDependencies } from "@/lib/tenant-switch-workflow";

test("switchTenantWithDependencies persists preference, refreshes, syncs server session, then redirects", async () => {
  const calls: string[] = [];
  const session = {
    access_token: "access-token",
    refresh_token: "refresh-token",
  };

  await switchTenantWithDependencies("tenant-2", "/dashboard", {
    persistPreferredTenant: async (tenantId) => {
      calls.push(`persist:${tenantId}`);
    },
    clearCache: () => {
      calls.push("clear");
    },
    refreshSession: async () => {
      calls.push("refresh");
      return { data: { session }, error: null };
    },
    syncSession: async (nextSession) => {
      calls.push(`sync:${nextSession?.access_token}`);
    },
    redirect: (path) => {
      calls.push(`redirect:${path}`);
    },
  });

  assert.deepEqual(calls, [
    "persist:tenant-2",
    "clear",
    "refresh",
    "sync:access-token",
    "clear",
    "redirect:/dashboard",
  ]);
});

test("switchTenantWithDependencies sanitizes redirect targets", async () => {
  const redirects: string[] = [];

  await switchTenantWithDependencies("tenant-2", "https://evil.test", {
    persistPreferredTenant: async () => {},
    clearCache: () => {},
    refreshSession: async () => ({
      data: {
        session: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
      },
      error: null,
    }),
    syncSession: async () => {},
    redirect: (path) => {
      redirects.push(path);
    },
  });

  assert.deepEqual(redirects, ["/projects"]);
});

test("switchTenantWithDependencies does not sync or redirect when refresh fails", async () => {
  const calls: string[] = [];
  const refreshError = new Error("refresh failed");

  await assert.rejects(
    switchTenantWithDependencies("tenant-2", "/dashboard", {
      persistPreferredTenant: async () => {
        calls.push("persist");
      },
      clearCache: () => {
        calls.push("clear");
      },
      refreshSession: async () => {
        calls.push("refresh");
        return { data: { session: null }, error: refreshError };
      },
      syncSession: async () => {
        calls.push("sync");
      },
      redirect: () => {
        calls.push("redirect");
      },
    }),
    refreshError,
  );

  assert.deepEqual(calls, ["persist", "clear", "refresh"]);
});
