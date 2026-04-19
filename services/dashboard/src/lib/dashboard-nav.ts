import {
  canPerform,
  type DashboardCapability,
} from "@/lib/dashboard-capabilities";
import type { DashboardRole } from "@/lib/dashboard-roles";

export type DashboardAccessRequirement =
  | { capability: DashboardCapability }
  | { anyOf: readonly DashboardCapability[] };

export type DashboardRouteConfig = {
  path: string;
  access: DashboardAccessRequirement;
};

export type DashboardNavItemConfig = {
  type: "item";
  href: string;
  label: string;
  iconName: string;
  access: DashboardAccessRequirement;
  readOnlyWhenMissingAccess?: DashboardAccessRequirement;
  activePrefixes?: readonly string[];
  excludedPrefixes?: readonly string[];
};

export type DashboardNavEntry = DashboardNavItemConfig;

export type DashboardNavSection = {
  id: string;
  title?: string;
  entries: readonly DashboardNavEntry[];
};

export const DASHBOARD_ROUTE_CONFIG = {
  dashboard: {
    path: "/dashboard",
    access: { capability: "overview.read" },
  },
  projects: {
    path: "/projects",
    access: { capability: "projects.read" },
  },
  events: {
    path: "/events",
    access: { capability: "events.read_project" },
  },
  performance: {
    path: "/performance",
    access: { capability: "performance.read" },
  },
  policyEngine: {
    path: "/policy-engine",
    access: { anyOf: ["policy.read_tenant", "policy.read_project"] },
  },
  policyEngineCreate: {
    path: "/policy-engine/new",
    access: { anyOf: ["policy.write_tenant", "policy.write_project"] },
  },
  policyEngineDetail: {
    path: "/policy-engine/[policy_id]",
    access: { anyOf: ["policy.read_tenant", "policy.read_project"] },
  },
  policyEngineRuleCreate: {
    path: "/policy-engine/[policy_id]/rules/new",
    access: { capability: "rules.write" },
  },
  policyEngineRuleEdit: {
    path: "/policy-engine/[policy_id]/rules/[rule_id]",
    access: { capability: "rules.write" },
  },
  policyEngineConnectors: {
    path: "/policy-engine/connectors",
    access: { capability: "connectors.read" },
  },
  proxies: {
    path: "/proxies",
    access: { capability: "proxies.read" },
  },
  security: {
    path: "/security",
    access: { capability: "security.read_tenant" },
  },
  settings: {
    path: "/settings",
    access: { capability: "settings.read" },
  },
  mcp: {
    path: "/mcp",
    access: { capability: "mcp.read" },
  },
  usersAdd: {
    path: "/users/add",
    access: { capability: "members.invite" },
  },
  usersMembers: {
    path: "/users/members",
    access: { capability: "members.read" },
  },
  violations: {
    path: "/violations",
    access: { capability: "violations.read_tenant" },
  },
  projectPackages: {
    path: "/projects/[project_id]/packages",
    access: { capability: "packages.read_project" },
  },
  projectSecurity: {
    path: "/projects/[project_id]/security",
    access: { capability: "security.read_project" },
  },
  projectSecurityConnectors: {
    path: "/projects/[project_id]/security/connectors",
    access: { capability: "connectors.read" },
  },
  projectTokens: {
    path: "/projects/[project_id]/tokens",
    access: { anyOf: ["tokens.read_all", "tokens.read_own"] },
  },
} satisfies Record<string, DashboardRouteConfig>;

export const DASHBOARD_NAV_SECTIONS: readonly DashboardNavSection[] = [
  {
    id: "main",
    entries: [
      {
        type: "item",
        href: DASHBOARD_ROUTE_CONFIG.dashboard.path,
        label: "Dashboard",
        iconName: "LayoutDashboard",
        access: DASHBOARD_ROUTE_CONFIG.dashboard.access,
      },
      {
        type: "item",
        href: DASHBOARD_ROUTE_CONFIG.projects.path,
        label: "Projects",
        iconName: "FolderOpen",
        access: DASHBOARD_ROUTE_CONFIG.projects.access,
      },
      {
        type: "item",
        href: DASHBOARD_ROUTE_CONFIG.events.path,
        label: "Events",
        iconName: "Zap",
        access: DASHBOARD_ROUTE_CONFIG.events.access,
      },
      {
        type: "item",
        href: DASHBOARD_ROUTE_CONFIG.performance.path,
        label: "Performance",
        iconName: "BarChart3",
        access: DASHBOARD_ROUTE_CONFIG.performance.access,
      },
    ],
  },
  {
    id: "policy",
    title: "Policy",
    entries: [
      {
        type: "item",
        href: DASHBOARD_ROUTE_CONFIG.policyEngine.path,
        label: "Policies",
        iconName: "Shield",
        access: DASHBOARD_ROUTE_CONFIG.policyEngine.access,
        activePrefixes: ["/policy-engine"],
        excludedPrefixes: ["/policy-engine/connectors"],
        readOnlyWhenMissingAccess: {
          anyOf: ["policy.write_tenant", "policy.write_project"],
        },
      },
      {
        type: "item",
        href: DASHBOARD_ROUTE_CONFIG.security.path,
        label: "Findings",
        iconName: "AlertTriangle",
        access: DASHBOARD_ROUTE_CONFIG.security.access,
      },
      {
        type: "item",
        href: DASHBOARD_ROUTE_CONFIG.policyEngineConnectors.path,
        label: "Connectors",
        iconName: "Cable",
        access: DASHBOARD_ROUTE_CONFIG.policyEngineConnectors.access,
        readOnlyWhenMissingAccess: { capability: "connectors.write" },
      },
    ],
  },
  {
    id: "infrastructure",
    title: "Infrastructure",
    entries: [
      {
        type: "item",
        href: DASHBOARD_ROUTE_CONFIG.proxies.path,
        label: "Proxies",
        iconName: "Globe",
        access: DASHBOARD_ROUTE_CONFIG.proxies.access,
        readOnlyWhenMissingAccess: { capability: "proxies.write" },
      },
      {
        type: "item",
        href: DASHBOARD_ROUTE_CONFIG.mcp.path,
        label: "MCP",
        iconName: "Bot",
        access: DASHBOARD_ROUTE_CONFIG.mcp.access,
      },
    ],
  },
  {
    id: "team",
    title: "Team",
    entries: [
      {
        type: "item",
        href: DASHBOARD_ROUTE_CONFIG.usersMembers.path,
        label: "Members",
        iconName: "Users",
        access: DASHBOARD_ROUTE_CONFIG.usersMembers.access,
      },
      {
        type: "item",
        href: DASHBOARD_ROUTE_CONFIG.usersAdd.path,
        label: "Grant Access",
        iconName: "UserPlus",
        access: DASHBOARD_ROUTE_CONFIG.usersAdd.access,
      },
    ],
  },
  {
    id: "settings",
    title: "Settings",
    entries: [
      {
        type: "item",
        href: DASHBOARD_ROUTE_CONFIG.settings.path,
        label: "Entitlements",
        iconName: "SlidersHorizontal",
        access: DASHBOARD_ROUTE_CONFIG.settings.access,
        readOnlyWhenMissingAccess: { capability: "settings.write" },
      },
    ],
  },
] as const;

export function canAccessDashboardRequirement(
  role: DashboardRole,
  requirement: DashboardAccessRequirement,
): boolean {
  if ("capability" in requirement) {
    return canPerform(role, requirement.capability);
  }

  return requirement.anyOf.some((capability) => canPerform(role, capability));
}

export function canAccessDashboardRoute(
  role: DashboardRole,
  route: DashboardRouteConfig,
): boolean {
  return canAccessDashboardRequirement(role, route.access);
}

export function isNavItemActive(
  pathname: string,
  item: DashboardNavItemConfig,
): boolean {
  const activePrefixes = item.activePrefixes ?? [item.href];
  const excludedPrefixes = item.excludedPrefixes ?? [];

  if (excludedPrefixes.some((prefix) => pathname.startsWith(prefix))) {
    return false;
  }

  return activePrefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
