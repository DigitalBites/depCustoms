"use client";

/**
 * TenantSwitcher — sidebar dropdown for switching between tenants.
 *
 * Only rendered when the user belongs to more than one tenant.
 * On selection:
 *   1. Persists the preferred tenant.
 *   2. Refreshes the session to re-issue the JWT.
 *   3. Reloads so server components re-render with the new tenant context.
 */

import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Building2 } from "lucide-react";
import type { TenantInfo } from "@/components/dashboard-provider";
import { getUserErrorMessage } from "@/lib/api-error";
import { switchTenant } from "@/lib/tenant-switch";

interface TenantSwitcherProps {
  currentTenantId: string;
  tenants: TenantInfo[];
  compact?: boolean;
}

export function TenantSwitcher({
  currentTenantId,
  tenants,
  compact = false,
}: TenantSwitcherProps) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{
    bottom: number;
    left: number;
  } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const portalDropdownRef = useRef<HTMLDivElement>(null);
  const compactTriggerRef = useRef<HTMLButtonElement>(null);

  const current = tenants.find((t) => t.tenant_id === currentTenantId);
  const others = tenants.filter((t) => t.tenant_id !== currentTenantId);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      const clickedInsideTrigger = ref.current?.contains(target) ?? false;
      const clickedInsidePortal =
        portalDropdownRef.current?.contains(target) ?? false;

      if (!clickedInsideTrigger && !clickedInsidePortal) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  async function handleSwitch(tenantId: string) {
    setSwitching(true);
    setError(null);
    setOpen(false);
    try {
      await switchTenant(tenantId);
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to switch tenant"));
      setSwitching(false);
    }
  }

  function openDropdown() {
    if (compact && compactTriggerRef.current) {
      const r = compactTriggerRef.current.getBoundingClientRect();
      setDropdownPos({ bottom: window.innerHeight - r.top, left: r.right + 8 });
    }
    setOpen((v) => !v);
  }

  const dropdownContent = (
    <div>
      <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
        Switch workspace
      </p>
      <div className="px-3 py-1.5 border-b border-border mb-1">
        <p className="text-xs font-medium text-foreground truncate">
          {current?.tenant_name ?? "Unknown"}
        </p>
        <p className="text-[10px] text-muted-foreground capitalize">
          {current?.role} · current
        </p>
      </div>
      {others.map((t) => (
        <button
          type="button"
          key={t.tenant_id}
          onClick={() => handleSwitch(t.tenant_id)}
          className="w-full px-3 py-2 text-left hover:bg-accent transition-colors"
        >
          <p className="text-sm text-foreground truncate">{t.tenant_name}</p>
          <p className="text-xs text-muted-foreground capitalize">{t.role}</p>
        </button>
      ))}
    </div>
  );

  if (compact) {
    return (
      <div ref={ref} className="relative flex justify-center">
        <button
          ref={compactTriggerRef}
          type="button"
          onClick={openDropdown}
          disabled={switching}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          title={
            switching
              ? "Switching…"
              : (current?.tenant_name ?? "Switch workspace")
          }
        >
          <Building2 className="h-4 w-4" />
        </button>

        {open &&
          dropdownPos &&
          createPortal(
            <div
              ref={portalDropdownRef}
              style={{
                position: "fixed",
                bottom: dropdownPos.bottom,
                left: dropdownPos.left,
                zIndex: 9999,
              }}
              className="w-56 rounded-lg border border-border bg-card shadow-md py-1"
            >
              {dropdownContent}
            </div>,
            document.body,
          )}
      </div>
    );
  }

  return (
    <div ref={ref} className="relative px-3 pb-2">
      <button
        type="button"
        onClick={openDropdown}
        disabled={switching}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-left text-xs transition-colors hover:bg-accent disabled:opacity-50"
      >
        <p className="text-xs text-muted-foreground">Workspace</p>
        <p className="mt-0.5 truncate font-medium text-foreground">
          {switching ? "Switching…" : (current?.tenant_name ?? "Unknown")}
        </p>
        {others.length > 0 && (
          <span className="absolute right-5 top-1/2 -translate-y-1/2 text-muted-foreground">
            ⌄
          </span>
        )}
      </button>

      {error && <p className="mt-1 px-1 text-xs text-destructive">{error}</p>}

      {open && others.length > 0 && (
        <div className="absolute bottom-full left-3 right-3 mb-1 rounded-lg border border-border bg-card shadow-md py-1 z-50">
          <p className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
            Switch to
          </p>
          {others.map((t) => (
            <button
              type="button"
              key={t.tenant_id}
              onClick={() => handleSwitch(t.tenant_id)}
              className="w-full px-3 py-2 text-left hover:bg-accent transition-colors"
            >
              <p className="text-sm text-foreground">{t.tenant_name}</p>
              <p className="text-xs text-muted-foreground capitalize">
                {t.role}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
