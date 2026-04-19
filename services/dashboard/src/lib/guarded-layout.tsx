import type { ReactNode } from "react";
import { requireDashboardRoute } from "@/lib/dashboard-auth";
import type { DASHBOARD_ROUTE_CONFIG } from "@/lib/dashboard-nav";

export function createGuardedLayout(
  routeKey: keyof typeof DASHBOARD_ROUTE_CONFIG,
  fallback?: string,
) {
  return async function GuardedLayout({ children }: { children: ReactNode }) {
    await requireDashboardRoute(routeKey, fallback);
    return children;
  };
}
