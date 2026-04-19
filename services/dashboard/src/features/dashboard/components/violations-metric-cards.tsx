import { StatCard } from "@/components/stat-card";
import type { ViolationsSummary } from "@/features/violations/types";

// ---------------------------------------------------------------------------
// ViolationsMetricCards
// Renders the 4 violations stat cards.
// Mirrors the card layout used in ViolationsPanel — centralised here for
// reuse so the dashboard and the violations panel stay in sync.
// ---------------------------------------------------------------------------

function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-muted/65 px-4 py-3 shadow-sm animate-pulse">
      <div className="h-3 w-24 rounded bg-muted mb-2" />
      <div className="h-7 w-12 rounded bg-muted" />
    </div>
  );
}

/** Returns ↑ / ↓ / → and the matching accent colour based on the weekly delta. */
function trendDisplay(summary: ViolationsSummary): {
  arrow: string;
  accent: "red" | "green" | "muted";
} {
  if (summary.trend.delta > 0) return { arrow: "↑", accent: "red" };
  if (summary.trend.delta < 0) return { arrow: "↓", accent: "green" };
  return { arrow: "→", accent: "muted" };
}

export function ViolationsMetricCards({
  summary,
  loading,
  compact = false,
}: {
  summary: ViolationsSummary | null;
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

  const { arrow, accent } = trendDisplay(summary);

  return (
    <div className={gridClass}>
      <StatCard
        label="Open violations"
        value={String(summary.statusCounts.open)}
        sub={
          [
            summary.statusCounts.resolved > 0
              ? `${summary.statusCounts.resolved} resolved`
              : "",
            summary.statusCounts.suppressed > 0
              ? `${summary.statusCounts.suppressed} suppressed`
              : "",
          ]
            .filter(Boolean)
            .join(" · ") || "none resolved or suppressed"
        }
        className={cardClass}
        size={compact ? "compact" : "default"}
      />
      <StatCard
        label="Blocked requests"
        value={String(summary.blockedCount)}
        sub={
          summary.advisoryCount > 0
            ? `+ ${summary.advisoryCount} advisory-only`
            : "all open violations are blocking"
        }
        accent={summary.blockedCount > 0 ? "red" : undefined}
        className={cardClass}
        size={compact ? "compact" : "default"}
      />
      <StatCard
        label="Critical + High"
        value={`${summary.severityCounts.critical} / ${summary.severityCounts.high}`}
        sub={
          [
            summary.severityCounts.medium > 0
              ? `${summary.severityCounts.medium} medium`
              : "",
            summary.severityCounts.low > 0
              ? `${summary.severityCounts.low} low`
              : "",
          ]
            .filter(Boolean)
            .join(" · ") || "no medium or low"
        }
        accent={
          summary.severityCounts.critical + summary.severityCounts.high > 0
            ? "orange"
            : undefined
        }
        className={cardClass}
        size={compact ? "compact" : "default"}
      />
      <StatCard
        label="New this week"
        value={`${arrow} ${summary.trend.thisWeek}`.trim()}
        sub={
          summary.trend.priorWeek > 0
            ? `${summary.trend.priorWeek} prior week · ${summary.activeSuppressionsCount} active suppression${summary.activeSuppressionsCount !== 1 ? "s" : ""}`
            : `${summary.activeSuppressionsCount} active suppression${summary.activeSuppressionsCount !== 1 ? "s" : ""}`
        }
        accent={accent}
        className={cardClass}
        size={compact ? "compact" : "default"}
      />
    </div>
  );
}
