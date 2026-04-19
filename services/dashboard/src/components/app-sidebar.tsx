"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  BarChart3,
  Bot,
  Cable,
  FolderOpen,
  Globe,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  UserPlus,
  Users,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useDashboard } from "@/components/dashboard-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { UserMenu } from "@/components/user-menu";
import { TenantSwitcher } from "@/components/tenant-switcher";
import {
  DASHBOARD_NAV_SECTIONS,
  canAccessDashboardRequirement,
  isNavItemActive,
  type DashboardNavItemConfig,
  type DashboardNavSection,
} from "@/lib/dashboard-nav";
import type { DashboardRole } from "@/lib/dashboard-roles";
import type { DashboardTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Icon registry — maps iconName strings from nav config to Lucide components
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  FolderOpen,
  Zap,
  BarChart3,
  Shield,
  AlertTriangle,
  Cable,
  ShieldCheck,
  Globe,
  Bot,
  Users,
  UserPlus,
  SlidersHorizontal,
};

const STORAGE_KEY = "customs-sidebar-collapsed";

// ---------------------------------------------------------------------------
// AppSidebar
// ---------------------------------------------------------------------------

export function AppSidebar({
  userEmail,
  authProvider,
  initialTheme,
}: {
  userEmail: string;
  authProvider: string;
  initialTheme: DashboardTheme;
}) {
  const { tenantId, role, tenants } = useDashboard();
  const pathname = usePathname();
  const currentTenant = tenants.find((tenant) => tenant.tenant_id === tenantId);

  const [collapsed, setCollapsed] = useState(false);

  // Restore preference from localStorage after mount to avoid SSR mismatch
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") setCollapsed(true);
  }, []);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem(STORAGE_KEY, String(next));
  }

  const visibleSections = getVisibleSections(role);

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-border bg-card",
        "transition-[width] duration-200 ease-in-out overflow-hidden",
        collapsed ? "w-[56px]" : "w-[220px]",
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex h-[57px] shrink-0 items-center border-b border-border",
          collapsed ? "justify-center" : "gap-2.5 px-4",
        )}
      >
        <ShieldCheck className="h-[18px] w-[18px] shrink-0 text-foreground" />
        {!collapsed && (
          <div className="min-w-0">
            <span className="block text-base font-semibold tracking-tight text-foreground">
              depCustoms
            </span>
            {currentTenant?.tenant_name ? (
              <span
                className="block truncate text-[11px] font-medium text-muted-foreground"
                title={currentTenant.tenant_name}
              >
                {currentTenant.tenant_name}
              </span>
            ) : null}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        <div className="space-y-0.5">
          {visibleSections.map((section, sectionIndex) => (
            <SectionBlock
              key={section.id}
              section={section}
              sectionIndex={sectionIndex}
              pathname={pathname}
              dashboardRole={role}
              collapsed={collapsed}
            />
          ))}
        </div>
      </nav>

      {/* Tenant switcher — only shown for multi-tenant users */}
      {tenants.length > 1 && (
        <div
          className={cn(
            "shrink-0 border-t border-border",
            collapsed ? "px-2 py-2" : "pt-2",
          )}
        >
          <TenantSwitcher
            currentTenantId={tenantId}
            tenants={tenants}
            compact={collapsed}
          />
        </div>
      )}

      {/* Collapse toggle */}
      <div className="shrink-0 border-t border-border px-2 py-2">
        <button
          type="button"
          onClick={toggleCollapse}
          className={cn(
            "flex items-center gap-2 rounded-md py-1.5 text-xs text-muted-foreground",
            "transition-colors hover:bg-accent hover:text-accent-foreground",
            collapsed ? "w-full justify-center" : "w-full px-2",
          )}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4 shrink-0" />
          ) : (
            <>
              <PanelLeftClose className="h-4 w-4 shrink-0" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>

      {/* Theme toggle */}
      <div className="shrink-0 border-t border-border px-2 py-2">
        <ThemeToggle initialTheme={initialTheme} compact={collapsed} />
      </div>

      {/* User menu */}
      <div className="shrink-0 border-t border-border px-2 py-2">
        <UserMenu
          email={userEmail}
          role={role}
          authProvider={authProvider}
          compact={collapsed}
        />
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// SectionBlock — renders a section title + its entries
// ---------------------------------------------------------------------------

function SectionBlock({
  section,
  sectionIndex,
  pathname,
  dashboardRole,
  collapsed,
}: {
  section: DashboardNavSection;
  sectionIndex: number;
  pathname: string;
  dashboardRole: DashboardRole;
  collapsed: boolean;
}) {
  return (
    <div className={cn(sectionIndex > 0 && "mt-1")}>
      {/* Section title (expanded) or divider (collapsed) */}
      {section.title &&
        (collapsed ? (
          <div className="my-2 border-t border-border/50" />
        ) : (
          <p className="mb-1 px-2 pt-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
            {section.title}
          </p>
        ))}

      <div className="space-y-0.5">
        {section.entries.map((entry) => (
          <NavItem
            key={entry.href}
            entry={entry}
            active={isNavItemActive(pathname, entry)}
            badge={getNavBadge(dashboardRole, entry)}
            collapsed={collapsed}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NavItem — icon + label link, tooltip in collapsed mode
// ---------------------------------------------------------------------------

function NavItem({
  entry,
  active,
  badge,
  collapsed,
}: {
  entry: DashboardNavItemConfig;
  active: boolean;
  badge?: string;
  collapsed: boolean;
}) {
  const Icon = ICON_MAP[entry.iconName];

  const linkClass = cn(
    "flex items-center rounded-md py-1.5 text-sm transition-colors",
    collapsed ? "justify-center px-0 w-full h-9" : "gap-2.5 px-2.5",
    active
      ? "bg-accent text-accent-foreground font-medium"
      : "text-foreground/80 hover:bg-accent hover:text-accent-foreground",
  );

  const inner = (
    <>
      {Icon && <Icon className="h-[15px] w-[15px] shrink-0" />}
      {!collapsed && (
        <>
          <span className="truncate">{entry.label}</span>
          {badge && (
            <span className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] bg-muted text-muted-foreground">
              {badge}
            </span>
          )}
        </>
      )}
    </>
  );

  if (collapsed) {
    return (
      <NavTooltip label={entry.label}>
        <Link href={entry.href} className={linkClass}>
          {inner}
        </Link>
      </NavTooltip>
    );
  }

  return (
    <Link href={entry.href} className={linkClass}>
      {inner}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// NavTooltip — portal-based tooltip that escapes the sidebar overflow bounds
// ---------------------------------------------------------------------------

function NavTooltip({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const [tooltipPos, setTooltipPos] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  function handleMouseEnter() {
    if (wrapperRef.current) {
      const r = wrapperRef.current.getBoundingClientRect();
      setTooltipPos({ top: r.top + r.height / 2, left: r.right + 8 });
    }
  }

  return (
    <div
      ref={wrapperRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setTooltipPos(null)}
    >
      {children}
      {tooltipPos &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: tooltipPos.top,
              left: tooltipPos.left,
              transform: "translateY(-50%)",
              zIndex: 9999,
              pointerEvents: "none",
            }}
            className="rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background shadow-md whitespace-nowrap"
          >
            {label}
          </div>,
          document.body,
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVisibleSections(role: DashboardRole): DashboardNavSection[] {
  return DASHBOARD_NAV_SECTIONS.map((section) => ({
    ...section,
    entries: section.entries.filter((entry) =>
      canAccessDashboardRequirement(role, entry.access),
    ),
  })).filter((section) => section.entries.length > 0);
}

function getNavBadge(
  role: DashboardRole,
  entry: DashboardNavItemConfig,
): string | undefined {
  if (!entry.readOnlyWhenMissingAccess) {
    return undefined;
  }

  return canAccessDashboardRequirement(role, entry.readOnlyWhenMissingAccess)
    ? undefined
    : "read-only";
}
