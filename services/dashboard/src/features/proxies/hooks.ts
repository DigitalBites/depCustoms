import { useCallback, useEffect, useState } from "react";
import { getUserErrorMessage } from "@/lib/api-error";
import { fetchProxies } from "@/features/proxies/api";
import type { ProxyRecord } from "@/features/proxies/types";

export function useProxies() {
  const [proxies, setProxies] = useState<ProxyRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setProxies(await fetchProxies());
    } catch (err) {
      setProxies([]);
      setError(getUserErrorMessage(err, "Failed to load proxies"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    proxies,
    loading,
    error,
    setError,
    setProxies,
    reload,
  };
}
