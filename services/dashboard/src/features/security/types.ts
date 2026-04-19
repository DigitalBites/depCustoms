export interface SecuritySummary {
  projectId: string;
  computedAt: string;
  findings: {
    open: number;
    suppressed: number;
    bySeverity: { critical: number; high: number; medium: number; low: number };
    oldestOpenDays: number | null;
  };
  violations: {
    blocks30d: number;
    blocks7d: number;
    trend7d: number;
  };
  suppressions: number;
  connectors: {
    osv: {
      lastSyncedAt: string | null;
      newFindings: number | null;
      syncedCount: number | null;
    };
  };
}

export type SecurityTab = "findings" | "violations" | "contributors" | "actors";

export type SecurityScope =
  | { kind: "tenant" }
  | { kind: "project"; projectId: string };
