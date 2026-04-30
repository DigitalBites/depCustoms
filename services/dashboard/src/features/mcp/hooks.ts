import { useCallback, useMemo, useState } from "react";
import { useDashboard } from "@/components/dashboard-provider";
import {
  bootstrapMcpConnection,
  fetchMcpAvailability,
} from "@/features/mcp/api";
import type { McpClientId, McpConnectionBootstrap } from "@/features/mcp/types";
import { getUserErrorMessage } from "@/lib/api-error";
import { useResource } from "@/hooks/useResource";

export function useMcpEntitlement() {
  const { tenantId } = useDashboard();
  const loadAvailability = useCallback(
    async () => (await fetchMcpAvailability(tenantId)).mcp_enabled,
    [tenantId],
  );
  const {
    data: enabled,
    loading,
    error,
    reload,
  } = useResource<boolean>(loadAvailability, {
    initialData: false,
    errorPrefix: "Failed to load MCP availability",
  });

  return {
    loading,
    enabled,
    error,
    reload,
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
