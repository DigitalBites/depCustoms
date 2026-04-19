// Badges for policy status and enforcement mode.

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active:
      "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400",
    draft:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
    archived: "bg-muted text-muted-foreground",
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
    enforcing: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    advisory:
      "bg-blue-100 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
    disabled: "bg-muted text-muted-foreground",
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
    open: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    resolved:
      "bg-green-100 text-green-700 dark:bg-green-900/20 dark:text-green-400",
    suppressed: "bg-muted text-muted-foreground",
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
    open: "bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-400",
    suppressed:
      "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400",
    resolved:
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
