"use client";

import { useEffect, useState } from "react";
import { useDashboard } from "@/components/dashboard-provider";
import { StatCard } from "@/components/stat-card";
import { InlineError } from "@/components/feedback/inline-error";
import { PageHeader } from "@/components/layout/page-header";
import { PageLoading } from "@/components/feedback/page-loading";
import { ContributorPackagesPage } from "@/features/contributors/components/contributor-packages-page";
import { ContributorPublishersPage } from "@/features/contributors/components/contributor-publishers-page";
import { PackageFindingsPanel } from "@/features/findings/components/package-findings-panel";
import { TabBar } from "@/components/ui/tab-bar";
import { useSecuritySummary } from "@/features/security/hooks";
import { SecurityViolationsPanel } from "@/features/violations/components/security-violations-panel";
import { canPerform } from "@/lib/dashboard-capabilities";
import type { SecurityScope, SecurityTab } from "@/features/security/types";

export function SecurityHub({
  scope,
  projectName,
  initialTab,
}: {
  scope: SecurityScope;
  projectName?: string;
  initialTab?: string;
}) {
  const { role, tenantId } = useDashboard();
  const canReadConnectors = canPerform(role, "connectors.read");
  const isProjectScope = scope.kind === "project";
  const tabs = getTabs(isProjectScope, canReadConnectors);
  const [activeTab, setActiveTab] = useState<SecurityTab>(
    getInitialTab(initialTab, tabs),
  );
  const { summary, loading, error } = useSecuritySummary(tenantId, scope);
  const title = isProjectScope
    ? `Security: ${projectName ?? "Project"}`
    : "Security: All Projects";
  const description = isProjectScope
    ? "Vulnerability findings, policy violations, and contributor-risk signals for this project."
    : "Vulnerability findings, policy violations, and contributor-risk signals across your tenant.";

  useEffect(() => {
    setActiveTab((current) =>
      tabs.some((tab) => tab.value === current)
        ? current
        : getInitialTab(initialTab, tabs),
    );
  }, [initialTab, canReadConnectors, isProjectScope]);

  const trendArrow = summary
    ? summary.violations.trend7d > 0
      ? "↑"
      : summary.violations.trend7d < 0
        ? "↓"
        : "→"
    : null;

  return (
    <div className="max-w-6xl space-y-6">
      <PageHeader
        title={title}
        description={description}
        className={isProjectScope ? "mb-0" : undefined}
      />

      {summary ? (
        <p className="-mt-4 text-xs text-muted-foreground">
          Updated {new Date(summary.computedAt).toLocaleString()}
        </p>
      ) : null}

      <InlineError message={error} />

      {!loading && summary ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <StatCard
            label="Open findings"
            value={String(summary.findings.open)}
            sub={`${summary.findings.suppressed} suppressed`}
            size="compact"
          />
          <StatCard
            label="Critical / High"
            value={`${summary.findings.bySeverity.critical} / ${summary.findings.bySeverity.high}`}
            sub="open findings by severity"
            size="compact"
            accent={
              summary.findings.bySeverity.critical +
                summary.findings.bySeverity.high >
              0
                ? "orange"
                : undefined
            }
          />
          <StatCard
            label="Policy blocks (30d)"
            value={String(summary.violations.blocks30d)}
            size="compact"
            sub={
              trendArrow
                ? `${trendArrow} ${Math.abs(summary.violations.trend7d)} vs prior week`
                : undefined
            }
            accent={summary.violations.blocks30d > 0 ? "red" : undefined}
          />
          <StatCard
            label="Oldest open"
            value={
              summary.findings.oldestOpenDays !== null
                ? `${summary.findings.oldestOpenDays}d`
                : "—"
            }
            sub="days since first seen"
            size="compact"
          />
        </div>
      ) : null}

      <TabBar items={tabs} value={activeTab} onChange={setActiveTab} />

      {activeTab === "contributors" ? (
        <ContributorPackagesPage
          scope={
            isProjectScope
              ? { kind: "project", projectId: scope.projectId, projectName }
              : { kind: "tenant", tenantId }
          }
          mode="embedded"
        />
      ) : activeTab === "actors" ? (
        <ContributorPublishersPage tenantId={tenantId} mode="embedded" />
      ) : activeTab === "findings" ? (
        loading ? (
          <PageLoading />
        ) : (
          <PackageFindingsPanel
            projectId={isProjectScope ? scope.projectId : undefined}
            onViolationClick={() => setActiveTab("violations")}
          />
        )
      ) : (
        <SecurityViolationsPanel
          projectId={isProjectScope ? scope.projectId : undefined}
          onNavigateToFindings={() => setActiveTab("findings")}
          emptyMessage={
            isProjectScope
              ? "No violations for this project yet."
              : "No violations recorded yet."
          }
        />
      )}
    </div>
  );
}

function getTabs(
  isProjectScope: boolean,
  canReadConnectors: boolean,
): Array<{ value: SecurityTab; label: string }> {
  const baseTabs: Array<{ value: SecurityTab; label: string }> = isProjectScope
    ? [
        { value: "findings", label: "Findings" },
        { value: "violations", label: "Violations" },
      ]
    : [
        { value: "violations", label: "Violations" },
        { value: "findings", label: "Findings" },
      ];

  return canReadConnectors
    ? [
        ...baseTabs,
        { value: "contributors", label: "Contributors" },
        ...(isProjectScope
          ? []
          : [{ value: "actors" as SecurityTab, label: "Actors" }]),
      ]
    : baseTabs;
}

function getInitialTab(
  initialTab: string | undefined,
  tabs: ReadonlyArray<{ value: SecurityTab; label: string }>,
): SecurityTab {
  if (initialTab && tabs.some((tab) => tab.value === initialTab)) {
    return initialTab as SecurityTab;
  }

  return tabs[0].value;
}
