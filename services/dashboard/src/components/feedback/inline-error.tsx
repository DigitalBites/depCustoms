import { cn } from "@/lib/utils";

export function InlineError({
  message,
  className,
}: {
  message: string | null;
  className?: string;
}) {
  if (!message) {
    return null;
  }

  return (
    <div
      className={cn(
        "rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive",
        className,
      )}
    >
      {message}
    </div>
  );
}
