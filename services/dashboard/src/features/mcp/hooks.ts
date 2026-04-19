import { useCallback, useEffect, useMemo, useState } from "react";
import { useDashboard } from "@/components/dashboard-provider";
import {
  bootstrapMcpConnection,
  fetchMcpAvailability,
} from "@/features/mcp/api";
import type { McpClientId, McpConnectionBootstrap } from "@/features/mcp/types";
import { getUserErrorMessage } from "@/lib/api-error";

export function useMcpEntitlement() {
  const { tenantId } = useDashboard();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const availability = await fetchMcpAvailability(tenantId);
      setEnabled(availability.mcp_enabled);
      setError(null);
    } catch (err) {
      setEnabled(false);
      setError(getUserErrorMessage(err, "Failed to load MCP availability"));
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  return {
    loading,
    enabled,
    error,
    reload: load,
  };
}

export function useMcpConnectionBootstrap() {
  const { tenantId } = useDashboard();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<McpConnectionBootstrap | null>(
    null,
  );

  const prepare = useCallback(
    async ({ clientName }: { clientName: McpClientId }) => {
      setLoading(true);
      setError(null);
      try {
        const nextConnection = await bootstrapMcpConnection({
          tenantId,
          clientName,
        });
        setConnection(nextConnection);
        return nextConnection;
      } catch (err) {
        setConnection(null);
        setError(getUserErrorMessage(err, "Failed to prepare MCP connection"));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [tenantId],
  );

  const supportedClients = useMemo(
    () => connection?.supported_clients ?? [],
    [connection],
  );

  return {
    loading,
    error,
    connection,
    supportedClients,
    prepare,
  };
}
