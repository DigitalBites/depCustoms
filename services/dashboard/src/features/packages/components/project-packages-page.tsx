"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { EmptyState } from "@/components/feedback/empty-state";
import { InlineError } from "@/components/feedback/inline-error";
import { PageLoading } from "@/components/feedback/page-loading";
import { PageHeader } from "@/components/layout/page-header";
import { ProjectBackLink } from "@/components/navigation/project-back-link";
import { StatCard } from "@/components/stat-card";
import { useProjectPackages } from "@/features/packages/hooks";
import type { PackageUsage } from "@/features/packages/types";
import { useProjectName } from "@/hooks/useProjectName";
import { getValidUuidParam } from "@/lib/route-params";

export function ProjectPackagesPage() {
  const { project_id: rawProjectId } = useParams<{ project_id: string }>();
  const projectId = getValidUuidParam(rawProjectId);
  const projectName = useProjectName(projectId ?? "");
  const { packages, loading, error } = useProjectPackages(projectId);
  const [search, setSearch] = useState("");

  if (!projectId) {
    return (
      <div className="max-w-6xl py-8">
        <p className="text-sm text-destructive">Invalid project identifier.</p>
        <div className="mt-2">
          <ProjectBackLink className="inline-block text-sm text-primary hover:underline" />
        </div>
      </div>
    );
  }

  const filtered = search.trim()
    ? packages.filter(
        (p) => {
          const packageName = p.name ?? p.package;
          return (
            packageName.toLowerCase().includes(search.toLowerCase()) ||
            p.version.toLowerCase().includes(search.toLowerCase()) ||
            (p.latest_version?.toLowerCase().includes(search.toLowerCase()) ??
              false) ||
            p.ecosystem.toLowerCase().includes(search.toLowerCase())
          );
        },
      )
    : packages;

  const totalRequests = packages.reduce((s, p) => s + p.request_count, 0);
  const totalBlocked = packages.reduce((s, p) => s + p.block_count, 0);
  const ecosystems = new Set(packages.map((p) => p.ecosystem)).size;

  return (
    <div className="max-w-6xl">
      <div className="mb-4">
        <ProjectBackLink />
      </div>
      <PageHeader
        title={`Packages: ${projectName}`}
        description="All packages observed through this project's proxy traffic."
      />
      <InlineError message={error} className="mb-4" />
      {loading ? (
        <PageLoading />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard
              label="Unique packages"
              value={String(packages.length)}
              sub={`across ${ecosystems} ecosystem${ecosystems !== 1 ? "s" : ""}`}
            />
            <StatCard
              label="Total requests"
              value={String(totalRequests)}
              sub="all-time"
            />
            <StatCard
              label="Blocked requests"
              value={String(totalBlocked)}
              sub={
                totalRequests > 0
                  ? `${((totalBlocked / totalRequests) * 100).toFixed(1)}% block rate`
                  : undefined
              }
            />
            <StatCard
              label="Ecosystems"
              value={String(ecosystems)}
              sub={
                packages.length > 0
                  ? [...new Set(packages.map((p) => p.ecosystem))].join(", ")
                  : "none"
              }
            />
          </div>
          {packages.length === 0 ? (
            <EmptyState message="No packages recorded yet. Traffic will appear here once the proxy starts forwarding requests." />
          ) : (
            <>
              <div className="mb-3">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter by package, version, or ecosystem…"
                  className="w-full max-w-sm rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
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
                        Latest
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                        Ecosystem
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                        Requests
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                        Allowed
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                        Blocked
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                        First seen
                      </th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                        Last seen
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((pkg, idx) => (
                      <PackageRow
                        key={pkg.id}
                        pkg={pkg}
                        showDivider={idx < filtered.length - 1}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && search ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  No packages match &quot;{search}&quot;.
                </p>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}

function PackageRow({
  pkg,
  showDivider,
}: {
  pkg: PackageUsage;
  showDivider: boolean;
}) {
  const hasLatestVersion = !!pkg.latest_version;
  const isLatest = hasLatestVersion
    ? (pkg.is_latest ?? pkg.version === pkg.latest_version)
    : false;
  const currentVersionReleaseTitle = formatReleaseTitle(
    "Current version",
    pkg.used_version_published_at ?? null,
  );
  const latestVersionReleaseTitle = hasLatestVersion
    ? formatReleaseTitle(
        "Latest version",
        pkg.latest_version_published_at ?? null,
      )
    : undefined;
  const packageName = pkg.name ?? pkg.package;

  return (
    <tr className={showDivider ? "border-b border-border" : ""}>
      <td className="px-4 py-3 font-mono font-medium text-foreground">
        {packageName}
      </td>
      <td
        className="px-4 py-3 font-mono text-xs text-muted-foreground"
        title={currentVersionReleaseTitle}
      >
        {pkg.version}
      </td>
      <td className="px-4 py-3">
        {hasLatestVersion ? (
          <span
            className="font-mono text-xs text-muted-foreground"
            title={latestVersionReleaseTitle}
          >
            {pkg.latest_version}
          </span>
        ) : null}
      </td>
      <td className="px-4 py-3">
        {hasLatestVersion ? (
          <span
            className={
              isLatest
                ? "inline-flex rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700"
                : "inline-flex rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700"
            }
          >
            {isLatest ? "Latest" : "Update"}
          </span>
        ) : null}
      </td>
      <td className="px-4 py-3 text-muted-foreground capitalize">
        {pkg.ecosystem}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-foreground">
        {pkg.request_count.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-green-700 dark:text-green-400">
        {pkg.allow_count.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {pkg.block_count > 0 ? (
          <span className="text-destructive">
            {pkg.block_count.toLocaleString()}
          </span>
        ) : (
          <span className="text-muted-foreground">0</span>
        )}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {new Date(pkg.first_seen_at).toLocaleDateString()}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
        {new Date(pkg.last_seen_at).toLocaleDateString()}
      </td>
    </tr>
  );
}

function formatReleaseTitle(label: string, value: string | null) {
  if (!value) return undefined;
  return `${label} released ${new Date(value).toLocaleString()}`;
}
