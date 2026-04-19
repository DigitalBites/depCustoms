import { StatCard } from "@/components/stat-card";
import type { ViolationsSummary } from "@/features/violations/types";

export function ViolationsSummaryCards({
  summary,
  loading,
}: {
  summary: ViolationsSummary | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="animate-pulse rounded-lg border border-border bg-card px-4 py-3"
          >
            <div className="mb-2 h-3 w-24 rounded bg-muted" />
            <div className="h-7 w-12 rounded bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  const trendArrow =
    summary.trend.delta > 0 ? "↑" : summary.trend.delta < 0 ? "↓" : "→";
  const trendAccent =
    summary.trend.delta > 0
      ? "red"
      : summary.trend.delta < 0
        ? "green"
        : "muted";

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
      />
      <StatCard
        label="New this week"
        value={`${trendArrow} ${summary.trend.thisWeek}`.trim()}
        sub={
          summary.trend.priorWeek > 0
            ? `${summary.trend.priorWeek} prior week · ${summary.activeSuppressionsCount} active suppression${summary.activeSuppressionsCount !== 1 ? "s" : ""}`
            : `${summary.activeSuppressionsCount} active suppression${summary.activeSuppressionsCount !== 1 ? "s" : ""}`
        }
        accent={trendAccent}
      />
    </div>
  );
}
