import { fetchPerformance } from "@/features/performance/api";
import type {
  PerformanceData,
  PerformanceWindow,
} from "@/features/performance/types";
import { useCallback } from "react";
import { useResource } from "@/hooks/useResource";

export function usePerformance(window: PerformanceWindow) {
  const loadPerformance = useCallback(
    () => fetchPerformance(window),
    [window],
  );
  const { data, loading, error } = useResource<PerformanceData | null>(
    loadPerformance,
    {
      initialData: null,
      errorPrefix: "Failed to load metrics",
    },
  );

  return { data, loading, error };
}
