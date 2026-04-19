import test from "node:test";
import assert from "node:assert/strict";

import {
  DASHBOARD_ROUTE_CONFIG,
  canAccessDashboardRoute,
} from "@/lib/dashboard-nav";
import { canPerform } from "@/lib/dashboard-capabilities";
import type { DashboardRole } from "@/lib/dashboard-roles";

test("shared route config covers the guarded dashboard surface", () => {
  const expectedPaths = {
    dashboard: "/dashboard",
    projects: "/projects",
    events: "/events",
    performance: "/performance",
    policyEngine: "/policy-engine",
    policyEngineCreate: "/policy-engine/new",
    policyEngineDetail: "/policy-engine/[policy_id]",
    policyEngineRuleCreate: "/policy-engine/[policy_id]/rules/new",
    policyEngineRuleEdit: "/policy-engine/[policy_id]/rules/[rule_id]",
    policyEngineConnectors: "/policy-engine/connectors",
    proxies: "/proxies",
    security: "/security",
    settings: "/settings",
    mcp: "/mcp",
    usersAdd: "/users/add",
    usersMembers: "/users/members",
    violations: "/violations",
    projectPackages: "/projects/[project_id]/packages",
    projectSecurity: "/projects/[project_id]/security",
    projectSecurityConnectors: "/projects/[project_id]/security/connectors",
    projectTokens: "/projects/[project_id]/tokens",
  } as const;

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(DASHBOARD_ROUTE_CONFIG).map(([key, value]) => [key, value.path]),
    ),
    expectedPaths,
  );
});

test("policy-engine route access allows both tenant-scoped and project-scoped readers and writers", () => {
  assert.equal(canAccessDashboardRoute("member", DASHBOARD_ROUTE_CONFIG.policyEngine), true);
  assert.equal(canAccessDashboardRoute("guest", DASHBOARD_ROUTE_CONFIG.policyEngine), false);
  assert.equal(canAccessDashboardRoute("owner", DASHBOARD_ROUTE_CONFIG.policyEngineCreate), true);
  assert.equal(canAccessDashboardRoute("admin", DASHBOARD_ROUTE_CONFIG.policyEngineCreate), true);
  assert.equal(canAccessDashboardRoute("guest", DASHBOARD_ROUTE_CONFIG.policyEngineCreate), false);
});

test("privileged route access stays aligned with the capability model", () => {
  const privilegedReadRoutes = [
    DASHBOARD_ROUTE_CONFIG.performance,
    DASHBOARD_ROUTE_CONFIG.proxies,
    DASHBOARD_ROUTE_CONFIG.security,
    DASHBOARD_ROUTE_CONFIG.settings,
    DASHBOARD_ROUTE_CONFIG.usersMembers,
    DASHBOARD_ROUTE_CONFIG.violations,
  ];

  for (const route of privilegedReadRoutes) {
    assert.equal(canAccessDashboardRoute("guest", route), false);
  }

  const privilegedWriteRoutes = [
    DASHBOARD_ROUTE_CONFIG.policyEngineRuleCreate,
    DASHBOARD_ROUTE_CONFIG.policyEngineRuleEdit,
    DASHBOARD_ROUTE_CONFIG.usersAdd,
  ];

  for (const route of privilegedWriteRoutes) {
    for (const role of ["owner", "admin"] satisfies DashboardRole[]) {
      assert.equal(canAccessDashboardRoute(role, route), true);
    }
  }
});

test("project token routes allow either all-token or own-token readers", () => {
  assert.equal(canAccessDashboardRoute("owner", DASHBOARD_ROUTE_CONFIG.projectTokens), true);
  assert.equal(canAccessDashboardRoute("admin", DASHBOARD_ROUTE_CONFIG.projectTokens), true);
  assert.equal(canAccessDashboardRoute("member", DASHBOARD_ROUTE_CONFIG.projectTokens), true);
  assert.equal(canAccessDashboardRoute("guest", DASHBOARD_ROUTE_CONFIG.projectTokens), false);
});

test("tenant-wide project access is expressed as a capability instead of hardcoded role checks", () => {
  assert.equal(canPerform("owner", "projects.read_all"), true);
  assert.equal(canPerform("admin", "projects.read_all"), true);
  assert.equal(canPerform("demo", "projects.read_all"), true);
  assert.equal(canPerform("member", "projects.read_all"), false);
  assert.equal(canPerform("guest", "projects.read_all"), false);
});

test("projects.read honors project membership context for scoped users", () => {
  assert.equal(canPerform("member", "projects.read", { hasProjectAccess: true }), true);
  assert.equal(canPerform("member", "projects.read", { hasProjectAccess: false }), false);
  assert.equal(canPerform("guest", "projects.read", { hasProjectAccess: true }), true);
  assert.equal(canPerform("guest", "projects.read", { hasProjectAccess: false }), false);
});
