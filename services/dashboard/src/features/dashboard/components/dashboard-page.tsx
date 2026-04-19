"use client";

import { useDashboard } from "@/components/dashboard-provider";
import { ContributorMetricCards } from "@/features/contributors/components/contributor-metric-cards";
import { useTenantMetrics, useProjectCards } from "@/features/dashboard/hooks";
import { OsvMetricCards } from "@/features/dashboard/components/osv-metric-cards";
import { ViolationsMetricCards } from "@/features/dashboard/components/violations-metric-cards";
import { ProjectGrid } from "@/features/dashboard/components/project-grid";
import { canPerform } from "@/lib/dashboard-capabilities";

// ---------------------------------------------------------------------------
// DashboardPage — tenant overview: top metrics + project grid
// ---------------------------------------------------------------------------

export function DashboardPage() {
  const { tenantId, role } = useDashboard();
  const canReadConnectors = canPerform(role, "connectors.read");

  const { data: metrics, loading: metricsLoading } = useTenantMetrics(tenantId);
  const {
    cards,
    loading: cardsLoading,
    projectsError,
  } = useProjectCards(tenantId, role);

  return (
    <div className="space-y-8">
      {/* Page title */}
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          Dashboard
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Security posture and dependency health across your tenant.
        </p>
      </div>

      {/* Tenant-level metrics */}
      <section className="px-1">
        <div className="mb-5">
          <h2 className="text-base font-semibold text-foreground">Overview</h2>
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Package Security
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Vulnerability exposure, remediation coverage, and exploitable
                package risk.
              </p>
            </div>
            <OsvMetricCards
              summary={metrics.osvSummary}
              loading={metricsLoading}
              compact
            />
          </div>

          {canReadConnectors ? (
            <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
              <div className="mb-3">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Contributor Risk
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Publish-history continuity and maintainer-change signals
                    across scanned package versions.
                  </p>
                </div>
              </div>
              <ContributorMetricCards
                summary={metrics.contributorSummary}
                loading={metricsLoading}
                compact
              />
            </div>
          ) : null}

          <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Policy Violations
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Blocking activity, severity mix, and recent rule pressure across
                tenant traffic.
              </p>
            </div>
            <ViolationsMetricCards
              summary={metrics.violationsSummary}
              loading={metricsLoading}
              compact
            />
          </div>
        </div>
      </section>

      {/* Project cards */}
      <ProjectGrid cards={cards} loading={cardsLoading} error={projectsError} />
    </div>
  );
}
