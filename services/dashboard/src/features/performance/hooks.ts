import { useCallback, useEffect, useState } from "react";
import { fetchPerformance } from "@/features/performance/api";
import type {
  PerformanceData,
  PerformanceWindow,
} from "@/features/performance/types";
import { getUserErrorMessage } from "@/lib/api-error";

export function usePerformance(window: PerformanceWindow) {
  const [data, setData] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchPerformance(window));
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to load metrics"));
    } finally {
      setLoading(false);
    }
  }, [window]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { data, loading, error };
}
