"use client";

/**
 * DashboardProvider — React context for authenticated dashboard state.
 *
 * The server-side layout reads tenant_id, role, and the tenants array from
 * the Supabase JWT and passes them as props. Client components consume them
 * via useDashboard() rather than calling getSession() themselves.
 */

import { createContext, useContext } from "react";
import type { DashboardRole } from "@/lib/dashboard-roles";

export interface TenantInfo {
  tenant_id: string;
  tenant_name: string;
  role: DashboardRole;
}

interface DashboardContextValue {
  tenantId: string;
  role: DashboardRole;
  tenants: TenantInfo[];
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({
  tenantId,
  role,
  tenants,
  children,
}: {
  tenantId: string;
  role: DashboardRole;
  tenants: TenantInfo[];
  children: React.ReactNode;
}) {
  return (
    <DashboardContext.Provider value={{ tenantId, role, tenants }}>
      {children}
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx)
    throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}
