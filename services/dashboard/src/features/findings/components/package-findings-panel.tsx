"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  FindingStatusBadge,
  SeverityBadge,
} from "@/components/policy/policy-badge";
import { useDashboard } from "@/components/dashboard-provider";
import { canPerform } from "@/lib/dashboard-capabilities";
import { getUserErrorMessage } from "@/lib/api-error";
import { apiFetch } from "@/lib/api";
import {
  fetchProjectFindingPackages,
  fetchTenantFindingPackages,
} from "@/features/security/api";
import {
  ContributorEvidenceCard,
  ContributorTierPill,
  IntelligenceEvidenceCard,
  OsvEvidenceCard,
  SourcePill,
} from "@/features/findings/components/evidence-cards";
import type {
  FindingDisposition,
  UnifiedFindingPackage,
} from "@/features/findings/types";

const PAGE_LIMIT = 50;

export function PackageFindingsPanel({
  projectId,
  onViolationClick,
}: {
  projectId?: string;
  onViolationClick?: (entityId: string) => void;
}) {
  const { role, tenantId } = useDashboard();
  const canManageFindings = !!projectId && canPerform(role, "security.write");
  const canReadContributor = canPerform(role, "connectors.read");
  const [packages, setPackages] = useState<UnifiedFindingPackage[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPkg, setExpandedPkg] = useState<string | null>(null);
  const [savingFinding, setSavingFinding] = useState<string | null>(null);
  const [findingError, setFindingError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const data = projectId
        ? await fetchProjectFindingPackages(projectId, PAGE_LIMIT, 0)
        : await fetchTenantFindingPackages(tenantId, PAGE_LIMIT, 0);
      setPackages(data.packages);
      setTotal(data.pagination.total);
      setOffset(data.packages.length);
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to load findings"));
    } finally {
      setLoading(false);
    }
  }, [projectId, tenantId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function loadMore() {
    setLoadingMore(true);

    try {
      const data = projectId
        ? await fetchProjectFindingPackages(projectId, PAGE_LIMIT, offset)
        : await fetchTenantFindingPackages(tenantId, PAGE_LIMIT, offset);
      setPackages((prev) => [...prev, ...data.packages]);
      setOffset((prev) => prev + data.packages.length);
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to load more"));
    } finally {
      setLoadingMore(false);
    }
  }

  function recomputeAgg(findings: FindingDisposition[]): string | null {
    if (findings.length === 0) return null;
    if (findings.some((f) => f.status === "open")) return "open";
    if (findings.every((f) => f.status === "suppressed")) return "suppressed";
    return "resolved";
  }

  function recomputePackageFindingStatus(pkg: UnifiedFindingPackage) {
    return recomputeAgg([
      ...pkg.osv.findings,
      ...(pkg.intelligence?.findings ?? []),
    ]);
  }

  async function handleDisposition(
    findingRowId: string,
    status: "suppressed" | "resolved" | "open",
    note: string,
  ) {
    if (!projectId) return;

    setSavingFinding(findingRowId);
    setFindingError(null);

    try {
      await apiFetch(
        `/v1/projects/${projectId}/findings/${findingRowId}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({ status, status_note: note.trim() || null }),
        },
      );

      setPackages((prev) =>
        prev.map((pkg) => ({
          ...pkg,
          osv: {
            ...pkg.osv,
            findings: pkg.osv.findings.map((f) =>
              f.id === findingRowId
                ? { ...f, status, statusNote: note.trim() || null }
                : f,
            ),
            vulns: pkg.osv.vulns.map((v) =>
              v.disposition?.id === findingRowId
                ? {
                    ...v,
                    disposition: {
                      ...v.disposition,
                      status,
                      statusNote: note.trim() || null,
                    },
                  }
                : v,
            ),
            findingStatus: recomputeAgg(
              pkg.osv.findings.map((f) =>
                f.id === findingRowId ? { ...f, status } : f,
              ),
            ),
          },
        })),
      );
    } catch (err) {
      setFindingError(getUserErrorMessage(err, "Failed to update finding"));
    } finally {
      setSavingFinding(null);
    }
  }

  return (
    <div className="space-y-4">
      {findingError && (
        <p className="text-sm text-destructive">{findingError}</p>
      )}
      {error && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : packages.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          {projectId
            ? "No package findings for this project across OSV, intelligence, or contributor risk."
            : "No package findings across OSV, intelligence, or contributor risk."}
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="w-6 px-2 py-3" />
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Package
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Version
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Fix
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    OSV
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Intel
                  </th>
                  {canReadContributor ? (
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Contrib
                    </th>
                  ) : null}
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    CVEs
                  </th>
                  {!projectId ? (
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Projects
                    </th>
                  ) : null}
                  {canManageFindings ? (
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Findings
                    </th>
                  ) : null}
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap">
                    Last pulled
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Violations
                  </th>
                </tr>
              </thead>
              <tbody>
                {packages.map((pkg, idx) => {
                  const key = `${pkg.ecosystem}|${pkg.name}|${pkg.version}`;
                  const isExpanded = expandedPkg === key;
                  const isLast = idx === packages.length - 1;

                  return (
                    <React.Fragment key={key}>
                      <tr
                        className={`cursor-pointer hover:bg-muted/30 transition-colors ${!isExpanded && !isLast ? "border-b border-border" : ""}`}
                        onClick={() => setExpandedPkg(isExpanded ? null : key)}
                      >
                        <td className="px-2 py-3 text-center text-muted-foreground select-none">
                          <span
                            className={`inline-block transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                          >
                            ›
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono font-medium text-foreground">
                          {pkg.name}
                          {pkg.osv.networkExploitable ? (
                            <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">
                              NET
                            </span>
                          ) : null}
                        </td>
                        <td
                          className="px-4 py-3 font-mono text-muted-foreground"
                          title={formatReleaseTitle(
                            "Version",
                            pkg.versionPublishedAt,
                          )}
                        >
                          {pkg.version}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-foreground">
                          {pkg.osv.bestFixVersion ??
                            (pkg.osv.fixAvailable ? (
                              "available"
                            ) : (
                              <span className="text-muted-foreground">
                                none
                              </span>
                            ))}
                        </td>
                        <td className="px-4 py-3">
                          {pkg.osv.hasFindings ? (
                            <SeverityBadge severity={pkg.osv.highestSeverity} />
                          ) : (
                            <SourcePill label="NONE" tone="muted" />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {pkg.intelligence ? (
                            <SourcePill
                              label={pkg.intelligence.recommendedAction.toUpperCase()}
                              tone={
                                pkg.intelligence.recommendedAction === "block"
                                  ? "red"
                                  : pkg.intelligence.recommendedAction ===
                                      "review"
                                    ? "yellow"
                                    : "muted"
                              }
                            />
                          ) : (
                            <SourcePill label="NONE" tone="muted" />
                          )}
                        </td>
                        {canReadContributor ? (
                          <td className="px-4 py-3">
                            <ContributorTierPill
                              contributor={pkg.contributor}
                            />
                          </td>
                        ) : null}
                        <td className="px-4 py-3 text-muted-foreground">
                          {pkg.osv.vulnCount}
                        </td>
                        {!projectId ? (
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {pkg.projects && pkg.projects.length > 0
                              ? pkg.projects
                                  .map((project) => project.name)
                                  .join(", ")
                              : "—"}
                          </td>
                        ) : null}
                        {canManageFindings ? (
                          <td className="px-4 py-3">
                            {recomputePackageFindingStatus(pkg) ? (
                              <FindingStatusBadge
                                status={recomputePackageFindingStatus(pkg) ?? "open"}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                —
                              </span>
                            )}
                          </td>
                        ) : null}
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {pkg.lastPulledAt
                            ? new Date(pkg.lastPulledAt).toLocaleDateString()
                            : "—"}
                        </td>
                        <td
                          className="px-4 py-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {pkg.openViolationCount > 0 ? (
                            onViolationClick ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onViolationClick(
                                    `${pkg.ecosystem}:${pkg.name}:${pkg.version}`,
                                  )
                                }
                                className="text-xs text-primary hover:underline"
                              >
                                {pkg.openViolationCount}
                              </button>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {pkg.openViolationCount}
                              </span>
                            )
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          )}
                        </td>
                      </tr>

                      {isExpanded ? (
                        <tr className={!isLast ? "border-b border-border" : ""}>
                          <td />
                          <td
                            colSpan={
                              9 +
                              (canReadContributor ? 1 : 0) +
                              (!projectId ? 1 : 0) +
                              (canManageFindings ? 1 : 0)
                            }
                            className="px-4 pb-4 pt-1"
                          >
                            <div className="grid gap-4 lg:grid-cols-2">
                              <OsvEvidenceCard
                                vulns={pkg.osv.vulns}
                                canManage={canManageFindings}
                                savingFinding={savingFinding}
                                onDisposition={handleDisposition}
                              />
                              <IntelligenceEvidenceCard
                                intelligence={pkg.intelligence}
                              />
                              {canReadContributor ? (
                                <ContributorEvidenceCard
                                  contributor={pkg.contributor}
                                />
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {offset < total ? (
            <div className="text-center">
              <button
                type="button"
                onClick={() => void loadMore()}
                disabled={loadingMore}
                className="rounded-md border border-border bg-card px-4 py-2 text-sm text-foreground hover:bg-muted/50 disabled:opacity-50"
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

function formatReleaseTitle(label: string, value: string | null) {
  if (!value) return undefined;
  return `${label} released ${new Date(value).toLocaleString()}`;
}
