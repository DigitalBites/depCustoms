import { useEffect, useState } from "react";
import { fetchConnectors } from "@/features/connectors/api";
import type { Connector } from "@/features/connectors/types";
import { getUserErrorMessage } from "@/lib/api-error";

export function useConnectors() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchConnectors()
      .then(setConnectors)
      .catch((err) =>
        setError(getUserErrorMessage(err, "Failed to load connectors")),
      )
      .finally(() => setLoading(false));
  }, []);

  return { connectors, loading, error };
}
