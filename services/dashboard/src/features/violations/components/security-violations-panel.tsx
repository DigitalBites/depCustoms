"use client";

import React, { useCallback, useState } from "react";
import { useDashboard } from "@/components/dashboard-provider";
import {
  EnforcementBadge,
  SeverityBadge,
  ViolationStatusBadge,
} from "@/components/policy/policy-badge";
import {
  ContributorEvidenceCard,
  ContributorTierPill,
  IntelligenceEvidenceCard,
  OsvEvidenceCard,
  SourcePill,
} from "@/features/findings/components/evidence-cards";
import {
  fetchProjectViolationEntities,
  fetchTenantViolationEntities,
} from "@/features/security/api";
import type {
  ViolationEntitiesResponse,
  ViolationEntitySummary,
} from "@/features/violations/types";
import { apiFetch } from "@/lib/api";
import { canPerform } from "@/lib/dashboard-capabilities";
import {
  DEFAULT_PAGE_LIMIT,
  usePaginatedResource,
} from "@/hooks/usePaginatedResource";

type ViolationViewFilter = "all" | "open" | "resolved" | "suppressed";
const FILTER_OPTIONS: Array<{
  value: ViolationViewFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Closed" },
  { value: "suppressed", label: "Suppressed" },
];

export function SecurityViolationsPanel({
  projectId,
  onNavigateToFindings,
  emptyMessage,
}: {
  projectId?: string;
  onNavigateToFindings?: (entityId: string) => void;
  emptyMessage: string;
}) {
  const { tenantId, role } = useDashboard();
  const canReadContributor = canPerform(role, "connectors.read");
  const canWriteViolations = canPerform(role, "violations.write");
  const [expandedEntityId, setExpandedEntityId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [viewFilter, setViewFilter] = useState<ViolationViewFilter>("open");
  const loadViolations = useCallback(
    (limit: number, offset: number) =>
      projectId
        ? fetchProjectViolationEntities(projectId, limit, offset, viewFilter)
        : fetchTenantViolationEntities(tenantId, limit, offset, viewFilter),
    [projectId, tenantId, viewFilter],
  );
  const {
    items: entities,
    total,
    loading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    reload: loadData,
  } = usePaginatedResource<
    ViolationEntitiesResponse,
    ViolationEntitySummary
  >({
    errorPrefix: "Failed to load violations",
    getItems: (response) => response.entities,
    getTotal: (response) => response.pagination.total,
    loader: loadViolations,
    pageLimit: DEFAULT_PAGE_LIMIT,
  });

  async function handleViolationStatus(
    violationId: string,
    status: "resolved" | "suppressed",
    note: string,
  ) {
    setSavingId(violationId);
    try {
      await apiFetch(`/v1/violations/${violationId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, status_note: note.trim() || null }),
      });
      await loadData();
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setExpandedEntityId(null);
              setViewFilter(option.value);
            }}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
              viewFilter === option.value
                ? "border-foreground/20 bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : entities.length === 0 ? (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          {getEmptyMessage(emptyMessage, viewFilter)}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
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
                    Viol. sev
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Open viol.
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Viol. impact
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
                  {!projectId ? (
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Projects
                    </th>
                  ) : null}
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Evaluated
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                    Findings
                  </th>
                </tr>
              </thead>
              <tbody>
                {entities.map((entity, idx) => {
                  const isExpanded = expandedEntityId === entity.entityId;
                  const isLast = idx === entities.length - 1;
                  const hasFindings =
                    !!entity.evidence.osv?.hasFindings ||
                    entity.evidence.intelligence !== null ||
                    entity.evidence.contributor?.hasFinding === true;

                  return (
                    <React.Fragment key={entity.entityId}>
                      <tr
                        className={`cursor-pointer transition-colors hover:bg-muted/30 ${!isExpanded && !isLast ? "border-b border-border" : ""}`}
                        onClick={() =>
                          setExpandedEntityId(
                            isExpanded ? null : entity.entityId,
                          )
                        }
                      >
                        <td className="px-2 py-3 text-center text-muted-foreground select-none">
                          <span
                            className={`inline-block transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
                          >
                            ›
                          </span>
                        </td>
                        <td className="px-4 py-3 font-mono font-medium text-foreground">
                          {entity.name}
                          {entity.evidence.osv?.networkExploitable ? (
                            <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-400">
                              NET
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-muted-foreground">
                          {entity.version}
                        </td>
                        <td className="px-4 py-3">
                          {entity.highestSeverity === "NONE" ? (
                            <SourcePill label="NONE" tone="muted" />
                          ) : (
                            <SeverityBadge severity={entity.highestSeverity} />
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {entity.openCount}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {entity.blockedOpenCount} enforcing /{" "}
                          {entity.advisoryOpenCount} advisory
                        </td>
                        <td className="px-4 py-3">
                          {entity.evidence.osv?.hasFindings ? (
                            <SeverityBadge
                              severity={entity.evidence.osv.highestSeverity}
                            />
                          ) : (
                            <SourcePill label="NONE" tone="muted" />
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {entity.evidence.intelligence ? (
                            <SourcePill
                              label={entity.evidence.intelligence.recommendedAction.toUpperCase()}
                              tone={
                                entity.evidence.intelligence.recommendedAction ===
                                "block"
                                  ? "red"
                                  : entity.evidence.intelligence
                                        .recommendedAction === "review"
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
                              contributor={entity.evidence.contributor}
                            />
                          </td>
                        ) : null}
                        {!projectId ? (
                          <td className="px-4 py-3 text-xs text-muted-foreground">
                            {entity.projects.length > 0
                              ? entity.projects
                                  .map((project) => project.name)
                                  .join(", ")
                              : "—"}
                          </td>
                        ) : null}
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(
                            entity.latestEvaluatedAt,
                          ).toLocaleDateString()}
                        </td>
                        <td
                          className="px-4 py-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {hasFindings && onNavigateToFindings ? (
                            <button
                              type="button"
                              onClick={() =>
                                onNavigateToFindings(entity.entityId)
                              }
                              className="text-xs text-primary hover:underline"
                            >
                              View
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {hasFindings ? "Available" : "—"}
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
                              (!projectId ? 1 : 0)
                            }
                            className="px-4 pb-4 pt-1"
                          >
                            <div className="space-y-4">
                              <ViolationsEvidenceCard
                                entity={entity}
                                canWriteViolations={canWriteViolations}
                                savingId={savingId}
                                onStatusUpdate={handleViolationStatus}
                              />
                              <div className="border-t border-border/50 pt-4">
                                <div className="grid gap-4 lg:grid-cols-2">
                                  <OsvEvidenceCard
                                    vulns={entity.evidence.osv?.vulns ?? []}
                                    canManage={false}
                                    savingFinding={null}
                                    onDisposition={async () => {}}
                                  />
                                  <IntelligenceEvidenceCard
                                    intelligence={
                                      entity.evidence.intelligence ?? null
                                    }
                                  />
                                  {canReadContributor ? (
                                    <ContributorEvidenceCard
                                      contributor={entity.evidence.contributor}
                                    />
                                  ) : null}
                                </div>
                              </div>
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

          {hasMore ? (
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

function ViolationsEvidenceCard({
  entity,
  canWriteViolations,
  savingId,
  onStatusUpdate,
}: {
  entity: ViolationEntitySummary;
  canWriteViolations: boolean;
  savingId: string | null;
  onStatusUpdate: (
    violationId: string,
    status: "resolved" | "suppressed",
    note: string,
  ) => Promise<void>;
}) {
  return (
    <div className="space-y-3 rounded-md border border-border/60 bg-muted/10 p-3">
      <div className="flex items-center gap-2 border-b border-border/40 pb-1">
        <span className="text-xs font-medium text-muted-foreground">
          Violations
        </span>
        <SourcePill label={`${entity.violations.length} total`} tone="red" />
        {entity.openCount > 0 ? (
          <SourcePill label={`${entity.openCount} open`} tone="red" />
        ) : null}
        {entity.resolvedCount > 0 ? (
          <SourcePill label={`${entity.resolvedCount} resolved`} tone="blue" />
        ) : null}
        {entity.suppressedCount > 0 ? (
          <SourcePill
            label={`${entity.suppressedCount} suppressed`}
            tone="yellow"
          />
        ) : null}
      </div>

      <div className="space-y-3">
        {entity.violations.map((violation) => (
          <ViolationListItem
            key={violation.id}
            violation={violation}
            canWriteViolations={canWriteViolations}
            saving={savingId === violation.id}
            onStatusUpdate={onStatusUpdate}
          />
        ))}
      </div>
    </div>
  );
}

function ViolationListItem({
  violation,
  canWriteViolations,
  saving,
  onStatusUpdate,
}: {
  violation: ViolationEntitySummary["violations"][number];
  canWriteViolations: boolean;
  saving: boolean;
  onStatusUpdate: (
    violationId: string,
    status: "resolved" | "suppressed",
    note: string,
  ) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(violation.statusNote ?? "");
  const isOpen = violation.status === "open";

  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">
              {violation.ruleName ?? "Violation"}
            </span>
            {violation.policyName ? (
              <span className="text-muted-foreground">
                {violation.policyName}
              </span>
            ) : null}
            {violation.projectName ? (
              <span className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">
                {violation.projectName}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground">{violation.message}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SeverityBadge severity={violation.severity} />
          <EnforcementBadge mode={violation.enforcementMode} />
          <ViolationStatusBadge status={violation.status} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <span>{violation.blocked ? "Blocks package" : "Advisory only"}</span>
        <span>{new Date(violation.evaluatedAt).toLocaleString()}</span>
      </div>

      {violation.recommendedRemediation ? (
        <p className="mt-2 text-muted-foreground">
          Remediation: {violation.recommendedRemediation}
        </p>
      ) : null}

      {violation.statusNote && !editing ? (
        <p className="mt-2 italic text-muted-foreground">
          {violation.statusNote}
        </p>
      ) : null}

      {canWriteViolations && isOpen ? (
        <div className="mt-2">
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={1}
                placeholder="Note (optional)…"
                className="w-full resize-none rounded border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    await onStatusUpdate(violation.id, "resolved", note);
                    setEditing(false);
                  }}
                  disabled={saving}
                  className="rounded bg-green-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                >
                  Mark resolved
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await onStatusUpdate(violation.id, "suppressed", note);
                    setEditing(false);
                  }}
                  disabled={saving}
                  className="rounded border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
                >
                  Suppress
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setNote(violation.statusNote ?? "");
                  }}
                  className="rounded border border-border px-2 py-0.5 text-xs font-medium text-foreground hover:bg-accent"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
            >
              Manage
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

function getEmptyMessage(defaultMessage: string, filter: ViolationViewFilter) {
  switch (filter) {
    case "all":
      return defaultMessage;
    case "open":
      return "No open violations for this view.";
    case "resolved":
      return "No closed violations for this view.";
    case "suppressed":
      return "No suppressed violations for this view.";
  }
}
