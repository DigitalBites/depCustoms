import { SafeExternalLink } from "@/components/safe-external-link";

export type ConnectorFieldDisplay =
  | "badge"
  | "code"
  | "url"
  | "date"
  | "number";

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return `${value}`;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "[value]";
  }
}

export function ConnectorAttributeValue({
  value,
  display,
}: {
  value: unknown;
  display?: ConnectorFieldDisplay;
}) {
  if (value === null || value === undefined) return null;

  if (typeof value === "boolean") {
    if (!value) return null;
    return (
      <span className="rounded px-1.5 py-0.5 text-xs bg-orange-100 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400">
        yes
      </span>
    );
  }

  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== null && v !== undefined);
    if (items.length === 0) return null;
    if (display === "url") {
      return (
        <span className="flex flex-wrap gap-1">
          {items.map((item, index) => {
            const text = formatUnknownValue(item);
            return (
              <SafeExternalLink
                key={`${text}-${index}`}
                href={text}
                className="rounded px-1.5 py-0.5 text-xs font-mono bg-muted text-primary hover:underline truncate max-w-xs"
              >
                {text}
              </SafeExternalLink>
            );
          })}
        </span>
      );
    }
    return (
      <span className="flex flex-wrap gap-1">
        {items.map((item, index) => (
          <span
            key={`${formatUnknownValue(item)}-${index}`}
            className="rounded px-1.5 py-0.5 text-xs font-mono bg-muted text-muted-foreground"
          >
            {formatUnknownValue(item)}
          </span>
        ))}
      </span>
    );
  }

  const text = formatUnknownValue(value);
  if (!text) return null;

  if (display === "code") {
    return (
      <span className="font-mono text-xs bg-muted rounded px-1.5 py-0.5 text-foreground">
        {text}
      </span>
    );
  }
  if (display === "number") {
    return (
      <span className="font-mono text-xs text-foreground font-semibold">
        {text}
      </span>
    );
  }
  if (display === "badge") {
    return (
      <span className="rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground">
        {text}
      </span>
    );
  }
  if (display === "url") {
    return (
      <SafeExternalLink
        href={text}
        className="text-xs text-primary hover:underline font-mono"
      >
        {text}
      </SafeExternalLink>
    );
  }
  if (display === "date") {
    return (
      <span className="text-xs text-muted-foreground">
        {new Date(text).toLocaleDateString()}
      </span>
    );
  }

  return <span className="text-xs text-foreground">{text}</span>;
}
