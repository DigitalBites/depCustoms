"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/feedback/empty-state";
import { InlineError } from "@/components/feedback/inline-error";
import { PageLoading } from "@/components/feedback/page-loading";
import { PageHeader } from "@/components/layout/page-header";
import { StatCard } from "@/components/stat-card";
import { fetchTenantContributorPublishers } from "@/features/contributors/api";
import type { ContributorPublishersResponse } from "@/features/contributors/types";
import {
  DEFAULT_PAGE_LIMIT,
  usePaginatedResource,
} from "@/hooks/usePaginatedResource";

type ContributorPublishersPageMode = "page" | "embedded";

export function ContributorPublishersPage({
  tenantId,
  mode = "page",
}: {
  tenantId: string;
  mode?: ContributorPublishersPageMode;
}) {
  const isEmbedded = mode === "embedded";
  const [ecosystem, setEcosystem] = useState("");
  const [onlyFirstTime, setOnlyFirstTime] = useState(false);
  const loadPublishers = useCallback(
    (limit: number, offset: number) =>
      fetchTenantContributorPublishers(tenantId, {
        limit,
        offset,
        ecosystem: ecosystem || undefined,
        onlyFirstTime,
      }),
    [ecosystem, onlyFirstTime, tenantId],
  );
  const {
    items: publishers,
    total,
    offset,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
  } = usePaginatedResource<
    ContributorPublishersResponse,
    ContributorPublishersResponse["publishers"][number]
  >({
    errorPrefix: "Failed to load contributor publishers",
    getItems: (response) => response.publishers,
    getTotal: (response) => response.pagination.total,
    loader: loadPublishers,
    pageLimit: DEFAULT_PAGE_LIMIT,
  });

  const firstTimeCount = publishers.reduce(
    (sum, publisher) => sum + publisher.firstTimePublisherCount,
    0,
  );
  const continuityBreakCount = publishers.reduce(
    (sum, publisher) => sum + publisher.continuityBreakCount,
    0,
  );

  return (
    <div className="max-w-6xl space-y-6">
      {!isEmbedded ? (
        <PageHeader
          title="Contributor Publish Actors"
          description="Publish actors seen in this tenant, summarized by first-time publishes and prior-version continuity breaks."
        />
      ) : null}

      {!isEmbedded ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/security?tab=contributors"
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
          >
            Open contributor packages
          </Link>
        </div>
      ) : null}

      <InlineError message={error} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Publishers"
          value={String(total)}
          sub="matching current filters"
        />
        <StatCard
          label="First-time"
          value={String(firstTimeCount)}
          sub="versions published by a first-time actor for that package"
        />
        <StatCard
          label="Continuity breaks"
          value={String(continuityBreakCount)}
          sub="publisher changed from the immediately prior version"
        />
        <StatCard
          label="Filter"
          value={ecosystem || "All"}
          sub={onlyFirstTime ? "first-time only" : "all actors"}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(12rem,auto)_minmax(16rem,auto)_1fr] md:items-stretch">
        <label className="flex h-full flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Ecosystem</span>
          <select
            value={ecosystem}
            onChange={(event) => setEcosystem(event.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm"
          >
            <option value="">All ecosystems</option>
            <option value="npm">npm</option>
            <option value="pypi">pypi</option>
          </select>
        </label>
        <label className="flex h-full flex-col gap-1 text-sm">
          <span className="text-muted-foreground">First-time only</span>
          <span className="flex h-10 min-w-40 items-center gap-3 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm">
            <input
              type="checkbox"
              checked={onlyFirstTime}
              onChange={(event) => setOnlyFirstTime(event.target.checked)}
              className="h-4 w-4 rounded border-input"
            />
            <span>Show first-time actors only</span>
          </span>
        </label>
        <div className="flex h-full items-center rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          First-time publisher count tracks package-local continuity. It does
          not assume a registry account-age API.
        </div>
      </div>

      {loading ? (
        <PageLoading />
      ) : publishers.length === 0 ? (
        <EmptyState message="No contributor publishers matched the current filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Publisher
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Ecosystem
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Packages
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    First-time
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                    Continuity breaks
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Last seen
                  </th>
                </tr>
              </thead>
              <tbody>
                {publishers.map((publisher, index) => (
                  <tr
                    key={`${publisher.ecosystem}:${publisher.publisherName}`}
                    className={
                      index < publishers.length - 1
                        ? "border-b border-border"
                        : ""
                    }
                  >
                    <td className="px-4 py-3 font-mono text-xs text-foreground">
                      {publisher.publisherName}
                    </td>
                    <td className="px-4 py-3 capitalize text-muted-foreground">
                      {publisher.ecosystem}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {publisher.packageCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {publisher.firstTimePublisherCount}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {publisher.continuityBreakCount}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {publisher.lastSeenAt
                        ? new Date(publisher.lastSeenAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore ? (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-md border border-border bg-background px-4 py-2 text-sm text-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                {loadingMore
                  ? "Loading…"
                  : `Load more (${total - offset} remaining)`}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
