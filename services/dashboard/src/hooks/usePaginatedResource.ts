"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getUserErrorMessage } from "@/lib/api-error";

export const DEFAULT_PAGE_LIMIT = 50;

export function usePaginatedResource<TResponse, TItem>({
  enabled = true,
  errorPrefix,
  getItems,
  getTotal,
  loader,
  onLoadMore,
  onReload,
  pageLimit = DEFAULT_PAGE_LIMIT,
}: {
  enabled?: boolean;
  errorPrefix: string;
  getItems: (response: TResponse) => TItem[];
  getTotal: (response: TResponse) => number;
  loader: (limit: number, offset: number) => Promise<TResponse>;
  onLoadMore?: (response: TResponse) => void;
  onReload?: (response: TResponse) => void;
  pageLimit?: number;
}) {
  const [items, setItems] = useState<TItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reloadVersionRef = useRef(0);

  const applyReload = useCallback(
    (response: TResponse) => {
      const nextItems = getItems(response);
      setItems(nextItems);
      setTotal(getTotal(response));
      setOffset(nextItems.length);
      onReload?.(response);
    },
    [getItems, getTotal, onReload],
  );

  const reload = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      setTotal(0);
      setOffset(0);
      setError(null);
      setLoading(false);
      return;
    }

    const reloadVersion = reloadVersionRef.current + 1;
    reloadVersionRef.current = reloadVersion;
    setLoading(true);
    setError(null);

    try {
      const response = await loader(pageLimit, 0);
      if (reloadVersionRef.current !== reloadVersion) {
        return;
      }
      applyReload(response);
    } catch (err) {
      if (reloadVersionRef.current !== reloadVersion) {
        return;
      }
      setItems([]);
      setTotal(0);
      setOffset(0);
      setError(getUserErrorMessage(err, errorPrefix));
    } finally {
      if (reloadVersionRef.current === reloadVersion) {
        setLoading(false);
      }
    }
  }, [applyReload, enabled, errorPrefix, loader, pageLimit]);

  const hasMore = offset < total;

  const loadMore = useCallback(async () => {
    if (!enabled || loadingMore || loading || !hasMore) {
      return;
    }

    setLoadingMore(true);
    try {
      const response = await loader(pageLimit, offset);
      const nextItems = getItems(response);
      setItems((prev) => [...prev, ...nextItems]);
      setOffset((prev) => prev + nextItems.length);
      setTotal(getTotal(response));
      onLoadMore?.(response);
    } catch (err) {
      setError(getUserErrorMessage(err, `Failed to load more ${errorPrefix.toLowerCase().replace(/^failed to load /, "")}`));
    } finally {
      setLoadingMore(false);
    }
  }, [
    enabled,
    errorPrefix,
    getItems,
    getTotal,
    hasMore,
    loader,
    loading,
    loadingMore,
    offset,
    onLoadMore,
    pageLimit,
  ]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return useMemo(
    () => ({
      error,
      hasMore,
      items,
      loadMore,
      loading,
      loadingMore,
      offset,
      reload,
      setError,
      setItems,
      total,
    }),
    [
      error,
      hasMore,
      items,
      loadMore,
      loading,
      loadingMore,
      offset,
      reload,
      total,
    ],
  );
}
