import { useCallback, useEffect, useState } from "react";
import { fetchEntitlements, saveEntitlements } from "@/features/settings/api";
import type { DashboardApiError } from "@/lib/api-error";
import { getUserErrorMessage } from "@/lib/api-error";
import { SUPPORTED_ECOSYSTEMS } from "@/lib/ecosystems";
import { SERVE_MODE } from "@customs/shared-constants";
import type { ServeMode } from "@customs/shared-constants";

export function useTenantEntitlements(tenantId: string) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [success, setSuccess] = useState(false);
  const [allowedEcosystems, setAllowedEcosystems] = useState<string[] | null>(
    null,
  );
  const [serveMode, setServeMode] = useState<ServeMode>(SERVE_MODE.REDIRECT);
  const [cacheTtl, setCacheTtl] = useState(300);
  const [mcpEnabled, setMcpEnabled] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const entitlements = await fetchEntitlements(tenantId);
      setAllowedEcosystems(entitlements.allowed_ecosystems);
      setServeMode(entitlements.serve_mode);
      setCacheTtl(entitlements.cache_ttl_seconds);
      setMcpEnabled(entitlements.mcp_enabled);
      setError(null);
      setErrorStatus(null);
    } catch (err) {
      const candidate = err as DashboardApiError;
      setErrorStatus(
        typeof candidate?.status === "number" ? candidate.status : null,
      );
      setError(getUserErrorMessage(err, "Failed to load settings"));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  function toggleEcosystem(eco: string) {
    setAllowedEcosystems((prev) => {
      const current = prev ?? [...SUPPORTED_ECOSYSTEMS];
      if (current.includes(eco)) {
        const next = current.filter((value) => value !== eco);
        if (next.length === 0) return [eco];
        return next.length === SUPPORTED_ECOSYSTEMS.length ? null : next;
      }
      const next = [...current, eco];
      return next.length === SUPPORTED_ECOSYSTEMS.length ? null : next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const entitlements = await saveEntitlements(tenantId, {
        allowed_ecosystems: allowedEcosystems,
        serve_mode: serveMode,
        cache_ttl_seconds: cacheTtl,
        mcp_enabled: mcpEnabled,
      });
      setAllowedEcosystems(entitlements.allowed_ecosystems);
      setServeMode(entitlements.serve_mode);
      setCacheTtl(entitlements.cache_ttl_seconds);
      setMcpEnabled(entitlements.mcp_enabled);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to save settings"));
    } finally {
      setSaving(false);
    }
  }

  return {
    loading,
    saving,
    error,
    errorStatus,
    success,
    allowedEcosystems,
    serveMode,
    cacheTtl,
    mcpEnabled,
    setServeMode,
    setCacheTtl,
    setMcpEnabled,
    toggleEcosystem,
    save,
  };
}
