"use client";

import { useCallback, useState } from "react";
import {
  fetchProjectOsvPackages,
  fetchProjectOsvSummary,
  fetchTenantOsvPackages,
  fetchTenantOsvSummary,
} from "@/features/findings/api";
import type {
  OsvPackage,
  OsvPackagesResponse,
  OsvSummary,
} from "@/features/findings/types";
import {
  DEFAULT_PAGE_LIMIT,
  usePaginatedResource,
} from "@/hooks/usePaginatedResource";

export function useOsvPackagesData({
  enabled = true,
  projectId,
  tenantId,
}: {
  enabled?: boolean;
  projectId?: string;
  tenantId: string;
}) {
  const loadOsvPackages = useCallback(
    async (limit: number, offset: number) => {
      const [summary, packageData] = await Promise.all([
        projectId
          ? fetchProjectOsvSummary(projectId)
          : fetchTenantOsvSummary(tenantId),
        projectId
          ? fetchProjectOsvPackages(projectId, limit, offset)
          : fetchTenantOsvPackages(tenantId, limit, offset),
      ]);

      return { summary, packageData };
    },
    [projectId, tenantId],
  );
  const [summary, setSummary] = useState<OsvSummary | null>(null);

  const {
    items: packages,
    total,
    offset,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    reload,
    setItems: setPackages,
  } = usePaginatedResource<
    {
      summary: OsvSummary;
      packageData: OsvPackagesResponse;
    },
    OsvPackage
  >({
    enabled,
    errorPrefix: "Failed to load OSV data",
    getItems: (response) => response.packageData.packages,
    getTotal: (response) => response.packageData.pagination.total,
    loader: loadOsvPackages,
    onLoadMore: (response) => {
      setSummary(response.summary);
    },
    onReload: (response) => {
      setSummary(response.summary);
    },
    pageLimit: DEFAULT_PAGE_LIMIT,
  });

  return {
    error,
    hasMore,
    loadMore,
    loading,
    loadingMore,
    offset,
    packages,
    reload,
    setPackages,
    summary,
    total,
  };
}
