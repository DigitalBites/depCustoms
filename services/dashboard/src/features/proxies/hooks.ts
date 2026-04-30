import { useEffect } from "react";
import { fetchProxies } from "@/features/proxies/api";
import type { ProxyRecord } from "@/features/proxies/types";
import { useResource } from "@/hooks/useResource";

export function useProxies() {
  const {
    data: proxies,
    loading,
    error,
    setError,
    setData: setProxies,
    reload,
  } = useResource<ProxyRecord[]>(fetchProxies, {
    initialData: [],
    errorPrefix: "Failed to load proxies",
  });

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
