import { StatCard } from "@/components/stat-card";
import type {
  ProjectContributorSummary,
  TenantContributorSummary,
} from "@/features/contributors/types";

function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-muted/65 px-4 py-3 shadow-sm animate-pulse">
      <div className="mb-2 h-3 w-24 rounded bg-muted" />
      <div className="h-7 w-12 rounded bg-muted" />
    </div>
  );
}

type ContributorSummary = TenantContributorSummary | ProjectContributorSummary;

export function ContributorMetricCards({
  summary,
  loading,
  compact = false,
}: {
  summary: ContributorSummary | null;
  loading: boolean;
  compact?: boolean;
}) {
  const gridClass = compact
    ? "grid grid-cols-2 gap-2.5"
    : "grid grid-cols-2 gap-4 sm:grid-cols-4";
  const cardClass = compact
    ? "bg-muted/55 shadow-none"
    : "bg-muted/65 shadow-sm";

  if (loading || !summary) {
    return (
      <div className={gridClass}>
        {[0, 1, 2, 3].map((i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  const riskyCount =
    summary.packages.byRisk.high + summary.packages.byRisk.medium;

  return (
    <div className={gridClass}>
      <StatCard
        label="Scored packages"
        value={String(summary.packages.totalScanned)}
        sub={`${summary.packages.notScanned} not yet scored`}
        className={cardClass}
        size={compact ? "compact" : "default"}
      />
      <StatCard
        label="High risk"
        value={String(summary.packages.byRisk.high)}
        sub={`${summary.packages.byRisk.medium} medium · ${summary.packages.byRisk.low} low`}
        accent={
          summary.packages.byRisk.high > 0
            ? "red"
            : riskyCount > 0
              ? "orange"
              : undefined
        }
        className={cardClass}
        size={compact ? "compact" : "default"}
      />
      <StatCard
        label="First-time publishers"
        value={String(summary.signals.firstTimePublisherCount)}
        sub={`${summary.signals.publisherChangeCount} publisher change${summary.signals.publisherChangeCount === 1 ? "" : "s"}`}
        accent={
          summary.signals.firstTimePublisherCount > 0 ? "orange" : undefined
        }
        className={cardClass}
        size={compact ? "compact" : "default"}
      />
      <StatCard
        label="Install scripts"
        value={String(summary.signals.installScriptsCount)}
        sub={
          summary.lastScoredAt
            ? `last scored ${new Date(summary.lastScoredAt).toLocaleDateString()}`
            : "no contributor scores yet"
        }
        accent={summary.signals.installScriptsCount > 0 ? "orange" : undefined}
        className={cardClass}
        size={compact ? "compact" : "default"}
      />
    </div>
  );
}
