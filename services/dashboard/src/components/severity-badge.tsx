"use client";

type Severity = string;

const SEVERITY_CLASSES: Record<string, string> = {
  CRITICAL: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  HIGH: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  MEDIUM:
    "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  LOW: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  NONE: "bg-muted text-muted-foreground",
};

export default function SeverityBadge({ severity }: { severity: Severity }) {
  const normalized = (severity ?? "").toUpperCase();
  const classes =
    SEVERITY_CLASSES[normalized] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${classes}`}
    >
      {normalized || "—"}
    </span>
  );
}
