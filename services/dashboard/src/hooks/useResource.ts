import { useCallback, useEffect, useRef, useState } from "react";
import { getUserErrorMessage } from "@/lib/api-error";

type UseResourceOptions<T> = {
  initialData: T;
  enabled?: boolean;
  suppressErrors?: boolean;
  errorPrefix: string;
  resetDataOnDisable?: boolean;
};

export function useResource<T>(
  loader: () => Promise<T>,
  options: UseResourceOptions<T>,
) {
  const {
    initialData,
    enabled = true,
    suppressErrors = false,
    errorPrefix,
    resetDataOnDisable = false,
  } = options;
  const initialDataRef = useRef(initialData);
  initialDataRef.current = initialData;

  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      if (resetDataOnDisable) {
        setData(initialDataRef.current);
      }
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      setData(await loader());
    } catch (err) {
      setData(initialDataRef.current);
      if (!suppressErrors) {
        setError(getUserErrorMessage(err, errorPrefix));
      }
    } finally {
      setLoading(false);
    }
  }, [enabled, errorPrefix, loader, resetDataOnDisable, suppressErrors]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    data,
    loading,
    error,
    setData,
    setError,
    reload,
  };
}
