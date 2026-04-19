// Shared summary stat card used on the violations hub and security page.

import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sub,
  accent,
  className,
  size = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "red" | "orange" | "green" | "muted";
  className?: string;
  size?: "default" | "compact";
}) {
  const valueClass =
    accent === "red"
      ? "text-red-600 dark:text-red-400"
      : accent === "orange"
        ? "text-orange-600 dark:text-orange-400"
        : accent === "green"
          ? "text-green-600 dark:text-green-400"
          : "text-foreground";

  const isCompact = size === "compact";

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card",
        isCompact ? "px-3 py-2.5" : "px-4 py-3",
        className,
      )}
    >
      <p
        className={cn(
          "text-muted-foreground",
          isCompact ? "text-[11px]" : "text-xs",
        )}
      >
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-semibold",
          isCompact ? "text-xl" : "text-2xl",
          valueClass,
        )}
      >
        {value}
      </p>
      {sub ? (
        <p
          className={cn(
            "mt-0.5 text-muted-foreground",
            isCompact ? "text-[11px]" : "text-xs",
          )}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}
