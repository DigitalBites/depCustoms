"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, KeyRound, Package, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DashboardProjectData } from "@/features/dashboard/types";
import { buildProjectDetailHref } from "@/lib/project-navigation";

// ---------------------------------------------------------------------------
// MetricBox — compact metric cell inside a project card
// ---------------------------------------------------------------------------

function MetricBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "red" | "orange";
}) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 text-xl font-semibold tabular-nums",
          accent === "red" && "text-red-600 dark:text-red-400",
          accent === "orange" && "text-orange-600 dark:text-orange-400",
          !accent && "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectCardSkeleton — shown while per-project data is loading
// ---------------------------------------------------------------------------

export function ProjectCardSkeleton() {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4 animate-pulse max-w-[320px]">
      <div className="h-4 w-32 rounded bg-muted mb-1" />
      <div className="h-3 w-20 rounded bg-muted mb-4" />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-md bg-muted h-14" />
        ))}
      </div>
      <div className="mt-4 flex gap-4 border-t border-border pt-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-3 w-14 rounded bg-muted" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ProjectCard — main component
// ---------------------------------------------------------------------------

export function ProjectCard({ data }: { data: DashboardProjectData }) {
  const { project, osvSummary, securitySummary, contributorSummary, error } =
    data;
  const [expanded, setExpanded] = useState(false);

  const packages = osvSummary?.packages.total ?? 0;
  const vulnerable = osvSummary?.packages.vulnerable ?? 0;
  const blocked = securitySummary?.violations.blocks30d ?? 0;
  const violations = securitySummary?.findings.open ?? 0;
  const suppressed = securitySummary?.findings.suppressed ?? 0;
  const critical = osvSummary?.packages.bySeverity.critical ?? 0;
  const high = osvSummary?.packages.bySeverity.high ?? 0;
  const oldestOpenDays = securitySummary?.findings.oldestOpenDays ?? null;
  const blocks7d = securitySummary?.violations.blocks7d ?? 0;
  const trend7d = securitySummary?.violations.trend7d ?? 0;
  const lastSyncedAt = securitySummary?.connectors.osv.lastSyncedAt ?? null;
  const contributorHighRisk = contributorSummary?.packages.byRisk.high ?? 0;
  const contributorFirstTimePublishers =
    contributorSummary?.signals.firstTimePublisherCount ?? 0;

  return (
    <div
      className={cn(
        "flex w-full max-w-[320px] flex-col overflow-hidden rounded-lg border border-border bg-card p-4 transition-all duration-300 hover:shadow-sm",
        expanded && "pb-1",
        "h-auto",
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            className="truncate text-sm font-semibold text-foreground"
            title={project.name}
          >
            {project.name}
          </h3>
          {project.created_at && (
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Created{" "}
              {new Date(project.created_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          )}
          {contributorSummary ? (
            <p className="mt-1 truncate text-[11px] text-muted-foreground">
              Contributor risk: {contributorHighRisk} high-risk
              {contributorFirstTimePublishers > 0
                ? ` · ${contributorFirstTimePublishers} first-time publisher${contributorFirstTimePublishers === 1 ? "" : "s"}`
                : ""}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          aria-pressed={expanded}
        >
          <ArrowRightLeft className="h-3 w-3" />
          {expanded ? "Front" : "Details"}
        </button>
      </div>

      <div className="[perspective:1200px]">
        <div
          className={cn(
            "relative transition-transform duration-500 [transform-style:preserve-3d]",
            expanded ? "h-[172px]" : "h-[132px]",
            expanded && "[transform:rotateY(180deg)]",
          )}
        >
          <div className="absolute inset-0 [backface-visibility:hidden]">
            {error && !osvSummary && !securitySummary ? (
              <div className="flex h-full items-center justify-center">
                <p className="py-4 text-center text-xs text-muted-foreground">
                  Failed to load metrics
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <MetricBox label="Packages" value={packages} />
                <MetricBox
                  label="Vulnerable"
                  value={vulnerable}
                  accent={vulnerable > 0 ? "orange" : undefined}
                />
                <MetricBox
                  label="Blocked (30d)"
                  value={blocked}
                  accent={blocked > 0 ? "red" : undefined}
                />
                <MetricBox label="Violations" value={violations} />
              </div>
            )}
          </div>

          <div className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
            <div className="flex flex-col rounded-lg bg-muted/35 p-1.5">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Expanded Detail
                </p>

                <div className="grid grid-cols-4 gap-1.5">
                  <MiniMetricBox
                    label="Crit"
                    value={critical}
                    accent={critical > 0 ? "red" : undefined}
                  />
                  <MiniMetricBox
                    label="High"
                    value={high}
                    accent={high > 0 ? "orange" : undefined}
                  />
                  <MiniMetricBox label="Supp" value={suppressed} />
                  <MiniMetricBox
                    label="7d"
                    value={blocks7d}
                    accent={blocks7d > 0 ? "red" : undefined}
                  />
                </div>

                <dl className="grid grid-cols-2 gap-1 text-xs">
                  <DetailRow
                    label="Oldest"
                    value={oldestOpenDays === null ? "—" : `${oldestOpenDays}d`}
                  />
                  <DetailRow label="Trend" value={formatSignedDelta(trend7d)} />
                  <DetailRow
                    label="OSV sync"
                    value={
                      lastSyncedAt ? formatShortDate(lastSyncedAt) : "Not yet"
                    }
                  />
                  <DetailRow
                    label="Status"
                    value={error ? "Partial" : "Healthy"}
                  />
                </dl>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer links */}
      {!expanded && (
        <div className="mt-3 flex items-center justify-between border-t border-border pt-2.5">
          <Link
            href={buildProjectDetailHref(
              `/projects/${project.id}/tokens`,
              "/dashboard",
            )}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <KeyRound className="h-3 w-3" />
            Tokens
          </Link>
          <Link
            href={buildProjectDetailHref(
              `/projects/${project.id}/packages`,
              "/dashboard",
            )}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Package className="h-3 w-3" />
            Packages
          </Link>
          <Link
            href={buildProjectDetailHref(
              `/projects/${project.id}/security`,
              "/dashboard",
            )}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ShieldCheck className="h-3 w-3" />
            Security
          </Link>
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/70 bg-background/70 px-2 py-1">
      <dt className="text-[9px] uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-xs font-semibold text-foreground">{value}</dd>
    </div>
  );
}

function MiniMetricBox({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "red" | "orange";
}) {
  return (
    <div className="rounded-md border border-border/70 bg-background/70 px-1.5 py-1.5">
      <p className="text-[8px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-sm font-semibold leading-none tabular-nums",
          accent === "red" && "text-red-600 dark:text-red-400",
          accent === "orange" && "text-orange-600 dark:text-orange-400",
          !accent && "text-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function formatShortDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatSignedDelta(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `${value}`;
  return "0";
}
