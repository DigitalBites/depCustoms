import { cn } from "@/lib/utils";

export function PageLoading({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>{label}</p>
  );
}
