import { StatCard } from "@/components/stat-card";
import type { OsvSummary } from "@/features/findings/types";

// ---------------------------------------------------------------------------
// OsvMetricCards
// Renders the 4 OSV package security stat cards.
// Mirrors the card layout used in OsvPackagesPanel — centralised here for
// reuse so the dashboard and the findings panel stay in sync.
// ---------------------------------------------------------------------------

function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-muted/65 px-4 py-3 shadow-sm animate-pulse">
      <div className="h-3 w-24 rounded bg-muted mb-2" />
      <div className="h-7 w-12 rounded bg-muted" />
    </div>
  );
}

export function OsvMetricCards({
  summary,
  loading,
  compact = false,
}: {
  summary: OsvSummary | null;
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

  return (
    <div className={gridClass}>
      <StatCard
        label="Total packages"
        value={String(summary.packages.total)}
        sub={`${summary.packages.unscanned} unscanned · ${summary.packages.clean} clean`}
        className={cardClass}
        size={compact ? "compact" : "default"}
      />
      <StatCard
        label="Vulnerable"
        value={String(summary.packages.vulnerable)}
        sub={`${summary.packages.bySeverity.critical} critical · ${summary.packages.bySeverity.high} high`}
        accent={summary.packages.vulnerable > 0 ? "orange" : undefined}
        className={cardClass}
        size={compact ? "compact" : "default"}
      />
      <StatCard
        label="Fix available"
        value={
          summary.packages.vulnerable > 0
            ? `${summary.fixes.available} / ${summary.packages.vulnerable}`
            : "—"
        }
        sub={
          summary.fixes.availableNotApplied > 0
            ? `${summary.fixes.availableNotApplied} not applied`
            : "all applied"
        }
        className={cardClass}
        size={compact ? "compact" : "default"}
      />
      <StatCard
        label="Network-exploitable"
        value={String(summary.exploitability.networkExploitable)}
        sub={
          summary.oldestUnresolvedDays !== null
            ? `oldest: ${summary.oldestUnresolvedDays}d`
            : undefined
        }
        accent={
          summary.exploitability.networkExploitable > 0 ? "red" : undefined
        }
        className={cardClass}
        size={compact ? "compact" : "default"}
      />
    </div>
  );
}
