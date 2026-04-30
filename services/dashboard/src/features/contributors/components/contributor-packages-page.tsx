"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { InlineError } from "@/components/feedback/inline-error";
import { PageLoading } from "@/components/feedback/page-loading";
import { EmptyState } from "@/components/feedback/empty-state";
import { ContributorMetricCards } from "@/features/contributors/components/contributor-metric-cards";
import {
  fetchProjectContributorPackages,
  fetchProjectContributorSummary,
  fetchTenantContributorPackages,
  fetchTenantContributorSummary,
} from "@/features/contributors/api";
import type {
  ContributorPackage,
  ContributorPackagesResponse,
  ProjectContributorSummary,
  TenantContributorSummary,
} from "@/features/contributors/types";
import { ProjectBackLink } from "@/components/navigation/project-back-link";
import {
  DEFAULT_PAGE_LIMIT,
  usePaginatedResource,
} from "@/hooks/usePaginatedResource";
type Scope =
  | { kind: "tenant"; tenantId: string }
  | { kind: "project"; projectId: string; projectName?: string };

type ContributorPackagesPageMode = "page" | "embedded";
type ScoreTier = "" | "HIGH" | "MEDIUM" | "LOW" | "NONE";

export function ContributorPackagesPage({
  scope,
  mode = "page",
}: {
  scope: Scope;
  mode?: ContributorPackagesPageMode;
}) {
  const isProjectScope = scope.kind === "project";
  const isEmbedded = mode === "embedded";
  const scopeId = isProjectScope ? scope.projectId : scope.tenantId;
  const projectName = isProjectScope ? scope.projectName : undefined;
  const [summary, setSummary] = useState<
    TenantContributorSummary | ProjectContributorSummary | null
  >(null);
  const [scoreTier, setScoreTier] = useState<ScoreTier>("");
  const [minScoreInput, setMinScoreInput] = useState("");

  const parsedMinScore = useMemo(() => {
    if (!minScoreInput.trim()) return undefined;
    const value = Number(minScoreInput);
    return Number.isFinite(value) ? value : undefined;
  }, [minScoreInput]);
  const loadContributorPackages = useCallback(
    async (limit: number, offset: number) => {
      const [summaryData, packageData] = await Promise.all([
        isProjectScope
          ? fetchProjectContributorSummary(scopeId)
          : fetchTenantContributorSummary(scopeId),
        isProjectScope
          ? fetchProjectContributorPackages(scopeId, {
              limit,
              offset,
              scoreTier: scoreTier || undefined,
              minScore: parsedMinScore,
            })
          : fetchTenantContributorPackages(scopeId, {
              limit,
              offset,
              scoreTier: scoreTier || undefined,
              minScore: parsedMinScore,
            }),
      ]);

      return { summaryData, packageData };
    },
    [isProjectScope, parsedMinScore, scopeId, scoreTier],
  );
  const {
    items: packages,
    total,
    offset,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
  } = usePaginatedResource<
    {
      summaryData: TenantContributorSummary | ProjectContributorSummary;
      packageData: ContributorPackagesResponse;
    },
    ContributorPackagesResponse["packages"][number]
  >({
    errorPrefix: "Failed to load contributor risk packages",
    getItems: (response) => response.packageData.packages,
    getTotal: (response) => response.packageData.pagination.total,
    loader: loadContributorPackages,
    onLoadMore: (response) => {
      setSummary(response.summaryData);
    },
    onReload: (response) => {
      setSummary(response.summaryData);
    },
    pageLimit: DEFAULT_PAGE_LIMIT,
  });

  return (
    <div className="max-w-6xl space-y-6">
      {isProjectScope && !isEmbedded ? <ProjectBackLink /> : null}

      {!isEmbedded ? (
        <PageHeader
          title={
            isProjectScope
              ? `Contributor Risk: ${projectName ?? "Project"}`
              : "Contributor Risk Packages"
          }
          description={
            isProjectScope
              ? "Packages in this project ranked by maintainer and publisher-risk signals."
              : "Tenant-wide contributor risk across scanned package versions and accessible projects."
          }
        />
      ) : null}

      <InlineError message={error} />

      {!isEmbedded ? (
        <div className="flex flex-wrap gap-2">
          {!isProjectScope ? (
            <Link
              href="/security?tab=actors"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
            >
              Open actors
            </Link>
          ) : (
            <Link
              href="/security?tab=contributors"
              className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-accent"
            >
              Open tenant contributor view
            </Link>
          )}
        </div>
      ) : !isProjectScope ? null : null}

      <ContributorMetricCards summary={summary} loading={loading} />

      <div className="grid gap-4 md:grid-cols-[auto_auto_1fr] md:items-end">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Risk tier</span>
          <select
            value={scoreTier}
            onChange={(event) => setScoreTier(event.target.value as ScoreTier)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm"
          >
            <option value="">All tiers</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
            <option value="NONE">Clean</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">Minimum score</span>
          <input
            type="number"
            min={0}
            max={100}
            value={minScoreInput}
            onChange={(event) => setMinScoreInput(event.target.value)}
            placeholder="0-100"
            className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm"
          />
        </label>
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Contributor risk scores reflect publish-history continuity, maintainer
          changes, install scripts, and other supply-chain indicators captured
          by the connector.
        </div>
      </div>

      {loading ? (
        <PageLoading />
      ) : packages.length === 0 ? (
        <EmptyState message="No scored contributor packages matched the current filters." />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Package
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Version
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Score
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Publisher
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Signals
                  </th>
                  {!isProjectScope ? (
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Projects
                    </th>
                  ) : null}
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Last scored
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Last pulled
                  </th>
                </tr>
              </thead>
              <tbody>
                {packages.map((pkg, index) => (
                  <tr
                    key={`${pkg.ecosystem}:${pkg.name}:${pkg.version}`}
                    className={
                      index < packages.length - 1
                        ? "border-b border-border"
                        : ""
                    }
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono font-medium text-foreground">
                        {pkg.name}
                      </div>
                      <div className="text-xs capitalize text-muted-foreground">
                        {pkg.ecosystem}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {pkg.version}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground">
                        {pkg.score}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {pkg.scoreTier}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {pkg.publisher ?? "Unknown"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <SignalList pkg={pkg} />
                    </td>
                    {!isProjectScope ? (
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {pkg.projects?.length
                          ? pkg.projects
                              .map((project) => project.name)
                              .join(", ")
                          : "—"}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTime(pkg.lastScoredAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDateTime(pkg.lastPulledAt)}
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

function SignalList({ pkg }: { pkg: ContributorPackage }) {
  const signals: string[] = [];
  if (pkg.publisherSeenBeforePackage === false)
    signals.push("first-time publisher");
  if (pkg.publisherMatchesPriorVersion === false)
    signals.push("publisher changed");
  if ((pkg.newMaintainerCount ?? 0) > 0)
    signals.push(
      `${pkg.newMaintainerCount} new maintainer${pkg.newMaintainerCount === 1 ? "" : "s"}`,
    );
  if ((pkg.removedMaintainerCount ?? 0) > 0)
    signals.push(
      `${pkg.removedMaintainerCount} removed maintainer${pkg.removedMaintainerCount === 1 ? "" : "s"}`,
    );
  if (pkg.hasInstallScripts) signals.push("install scripts");
  if (pkg.releaseVelocity7d !== null)
    signals.push(`${pkg.releaseVelocity7d}/7d`);
  if (pkg.releaseVelocity30d !== null)
    signals.push(`${pkg.releaseVelocity30d}/30d`);
  if (pkg.hasProvenance === false) signals.push("no provenance");
  if (pkg.hasTrustedPublisher) signals.push("trusted publisher");
  return signals.length > 0 ? signals.join(" · ") : "No notable signals";
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString() : "—";
}
