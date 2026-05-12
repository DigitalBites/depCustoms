// Badges for policy status and enforcement mode.

import {
  ENFORCEMENT_MODE,
  POLICY_STATUS,
  VIOLATION_STATUS,
} from "@customs/shared-constants";

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    [POLICY_STATUS.ACTIVE]:
      "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400",
    [POLICY_STATUS.DRAFT]:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
    [POLICY_STATUS.ARCHIVED]: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

export function EnforcementBadge({ mode }: { mode: string }) {
  const styles: Record<string, string> = {
    [ENFORCEMENT_MODE.ENFORCING]:
      "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    [ENFORCEMENT_MODE.ADVISORY]:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
    [ENFORCEMENT_MODE.DISABLED]: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[mode] ?? "bg-muted text-muted-foreground"}`}
    >
      {mode}
    </span>
  );
}

export function ScopeBadge({ scope }: { scope: string }) {
  return (
    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
      {scope}
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: string }) {
  const styles: Record<string, string> = {
    critical: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    high: "bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400",
    medium:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
    low: "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[severity?.toLowerCase()] ?? "bg-muted text-muted-foreground"}`}
    >
      {severity}
    </span>
  );
}

export function ViolationStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    [VIOLATION_STATUS.OPEN]:
      "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    [VIOLATION_STATUS.RESOLVED]:
      "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400",
    [VIOLATION_STATUS.SUPPRESSED]: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}

// Finding status uses yellow for suppressed (distinct from violation suppressed muted styling)
export function FindingStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    [VIOLATION_STATUS.OPEN]:
      "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    [VIOLATION_STATUS.SUPPRESSED]:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
    [VIOLATION_STATUS.RESOLVED]:
      "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400",
  };
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${styles[status] ?? "bg-muted text-muted-foreground"}`}
    >
      {status}
    </span>
  );
}
