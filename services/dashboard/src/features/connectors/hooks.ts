import { fetchConnectors } from "@/features/connectors/api";
import type { Connector } from "@/features/connectors/types";
import { useResource } from "@/hooks/useResource";

export function useConnectors() {
  const { data: connectors, loading, error } = useResource<Connector[]>(
    fetchConnectors,
    {
      initialData: [],
      errorPrefix: "Failed to load connectors",
    },
  );

  return { connectors, loading, error };
}
