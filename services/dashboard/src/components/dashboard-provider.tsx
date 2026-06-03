"use client";

/**
 * DashboardProvider — React context for authenticated dashboard state.
 *
 * The server-side layout reads tenant_id, role, and the tenants array from
 * the Supabase JWT and passes them as props. Client components consume them
 * via useDashboard() rather than calling getSession() themselves.
 */

import { createContext, useContext } from "react";
import { ConfirmDialogProvider } from "@/components/confirm-dialog-provider";
import type { DashboardRole } from "@/lib/dashboard-roles";
import type { TenantKind } from "@customs/shared-constants";

export interface TenantInfo {
  tenant_id: string;
  tenant_name: string;
  tenant_kind: TenantKind;
  role: DashboardRole;
}

interface DashboardContextValue {
  tenantId: string;
  tenantKind: TenantKind;
  role: DashboardRole;
  tenants: TenantInfo[];
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({
  tenantId,
  tenantKind,
  role,
  tenants,
  children,
}: {
  tenantId: string;
  tenantKind: TenantKind;
  role: DashboardRole;
  tenants: TenantInfo[];
  children: React.ReactNode;
}) {
  return (
    <DashboardContext.Provider value={{ tenantId, tenantKind, role, tenants }}>
      <ConfirmDialogProvider>{children}</ConfirmDialogProvider>
    </DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx)
    throw new Error("useDashboard must be used within DashboardProvider");
  return ctx;
}
