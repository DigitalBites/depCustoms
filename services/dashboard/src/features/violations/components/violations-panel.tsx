"use client";

/**
 * ViolationsPanel — shared violations list with summary cards, filters, table,
 * and pagination. Used on the global violations hub, project security page
 * (Violations tab), and policy detail page (Violations tab).
 *
 * Scope resolution:
 *   projectId set  → /v1/projects/:id/violations (+ /summary)
 *   policyId set   → /v1/policies/:id/violations (no per-policy summary)
 *   neither        → /v1/tenants/:id/violations  (+ /summary)
 */

import React from "react";
import { canPerform } from "@/lib/dashboard-capabilities";
import { useDashboard } from "@/components/dashboard-provider";
import { useViolationsPanelData } from "@/features/violations/hooks";
import {
  ViolationsBulkActions,
  ViolationsFilters,
} from "@/features/violations/components/violations-toolbar";
import { ViolationsSummaryCards } from "@/features/violations/components/violations-summary-cards";
import { ViolationsTable } from "@/features/violations/components/violations-table";
import { CAPABILITY } from "@customs/shared-constants";

export interface ViolationsPanelProps {
  /** Scope: set at most one. Omit for tenant-wide view. */
  projectId?: string;
  policyId?: string;
  /** External rule filter — passed in by the policy detail page's rule dropdown. */
  ruleId?: string;
  /** Hide the Project column when already in a project context. Default: true */
  showProjectColumn?: boolean;
  /**
   * Show summary stat cards above the table. Defaults to true when projectId
   * or tenant scope is used; defaults to false for policy scope.
   */
  showSummaryCards?: boolean;
  /**
   * Called when the user clicks the OSV findings badge. When provided the
   * badge becomes a button for same-page navigation.
   */
  onNavigateToFindings?: (packageVersionId: string) => void;
  /** Override the empty-state message. */
  emptyMessage?: string;
}

export function ViolationsPanel({
  projectId,
  policyId,
  ruleId,
  showProjectColumn = true,
  showSummaryCards,
  onNavigateToFindings,
  emptyMessage = "No violations found for this filter.",
}: ViolationsPanelProps) {
  const { tenantId, role } = useDashboard();
  const canWriteViolations = canPerform(role, CAPABILITY.VIOLATIONS_WRITE);

  // Default showSummaryCards: true unless policyId is set (policy scope has no summary endpoint)
  const shouldShowSummary =
    showSummaryCards ?? (policyId === null || policyId === undefined);
  const {
    summary,
    summaryLoading,
    violations,
    loading,
    error,
    statusFilter,
    setStatusFilter,
    severityFilter,
    setSeverityFilter,
    entityFilter,
    setEntityFilter,
    offset,
    hasMore,
    expandedId,
    expansionCache,
    loadingExpansion,
    expansionErrors,
    selectedViolationIds,
    setSelectedViolationIds,
    bulkNote,
    setBulkNote,
    bulkActing,
    allVisibleSelected,
    hasPartialVisibleSelection,
    loadViolations,
    handleExpand,
    handleViolationStatus,
    handleBulkViolationStatus,
    toggleViolationSelection,
    toggleAllVisibleViolations,
  } = useViolationsPanelData({
    tenantId,
    projectId,
    policyId,
    ruleId,
    shouldShowSummary,
  });

  return (
    <div className="space-y-6">
      {shouldShowSummary ? (
        <ViolationsSummaryCards summary={summary} loading={summaryLoading} />
      ) : null}

      <ViolationsFilters
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        severityFilter={severityFilter}
        setSeverityFilter={setSeverityFilter}
        entityFilter={entityFilter}
        setEntityFilter={setEntityFilter}
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <ViolationsBulkActions
        visible={
          canWriteViolations &&
          violations.length > 0 &&
          selectedViolationIds.length > 0
        }
        selectedCount={selectedViolationIds.length}
        onClear={() => setSelectedViolationIds([])}
        bulkNote={bulkNote}
        setBulkNote={setBulkNote}
        bulkActing={bulkActing}
        onResolve={() => void handleBulkViolationStatus("resolved")}
        onSuppress={() => void handleBulkViolationStatus("suppressed")}
      />

      {loading && violations.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      ) : violations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <ViolationsTable
          violations={violations}
          canWriteViolations={canWriteViolations}
          showProjectColumn={showProjectColumn}
          selectedViolationIds={selectedViolationIds}
          allVisibleSelected={allVisibleSelected}
          hasPartialVisibleSelection={hasPartialVisibleSelection}
          expandedId={expandedId}
          expansionCache={expansionCache}
          expansionErrors={expansionErrors}
          loadingExpansion={loadingExpansion}
          onNavigateToFindings={onNavigateToFindings}
          handleExpand={handleExpand}
          handleViolationStatus={handleViolationStatus}
          toggleViolationSelection={toggleViolationSelection}
          toggleAllVisibleViolations={toggleAllVisibleViolations}
          hasMore={hasMore}
          offset={offset}
          loadViolations={loadViolations}
          loading={loading}
        />
      )}
    </div>
  );
}
