import type { ReactNode } from "react";

export interface TabBarItem<T extends string> {
  value: T;
  label: ReactNode;
}

export function TabBar<T extends string>({
  items,
  value,
  onChange,
  className,
}: {
  items: ReadonlyArray<TabBarItem<T>>;
  value: T;
  onChange: (nextValue: T) => void;
  className?: string;
}) {
  return (
    <div className={className ?? "border-b border-border flex gap-0"}>
      {items.map((item) => (
        <button
          type="button"
          key={item.value}
          onClick={() => onChange(item.value)}
          className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
            value === item.value
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
