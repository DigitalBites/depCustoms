"use client";

import {
  ARRAY_VALUE_OPERATORS,
  NO_VALUE_OPERATORS,
} from "@/features/policies/types";

interface ValueInputProps {
  operator: string;
  dataType: string;
  enumValues?: string[];
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}

export function ValueInput({
  operator,
  dataType,
  enumValues,
  value,
  onChange,
  disabled,
}: ValueInputProps) {
  // No-value operators: render nothing
  if (NO_VALUE_OPERATORS.has(operator)) {
    return (
      <span className="text-sm text-muted-foreground italic">
        no value required
      </span>
    );
  }

  // Array operators with enum values: multi-select checkboxes
  if (
    ARRAY_VALUE_OPERATORS.has(operator) &&
    enumValues &&
    enumValues.length > 0
  ) {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    function toggle(v: string) {
      const next = selected.includes(v)
        ? selected.filter((s) => s !== v)
        : [...selected, v];
      onChange(next);
    }
    return (
      <div className="flex flex-wrap gap-1.5">
        {enumValues.map((v) => (
          <label key={v} className="flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(v)}
              onChange={() => toggle(v)}
              disabled={disabled}
              className="rounded border-border"
            />
            <span className="text-sm font-mono">{v}</span>
          </label>
        ))}
      </div>
    );
  }

  // Array operators without enum values: comma-separated text
  if (ARRAY_VALUE_OPERATORS.has(operator)) {
    const displayValue = Array.isArray(value)
      ? (value as string[]).join(", ")
      : ((value as string) ?? "");
    return (
      <input
        type="text"
        value={displayValue}
        onChange={(e) =>
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        }
        placeholder="value1, value2, …"
        disabled={disabled}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
      />
    );
  }

  // Boolean type: dropdown
  if (dataType === "boolean") {
    return (
      <div className="relative">
        <select
          value={value === true ? "true" : value === false ? "false" : ""}
          onChange={(e) => onChange(e.target.value === "true")}
          disabled={disabled}
          className="appearance-none w-full rounded-md border border-border bg-background px-2.5 py-1.5 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
        >
          <option value="">— select —</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>
    );
  }

  // Integer / float type
  if (dataType === "integer" || dataType === "float") {
    return (
      <input
        type="number"
        step={dataType === "float" ? "any" : "1"}
        value={(value as number) ?? ""}
        onChange={(e) =>
          onChange(
            dataType === "integer"
              ? parseInt(e.target.value, 10)
              : parseFloat(e.target.value),
          )
        }
        disabled={disabled}
        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
      />
    );
  }

  // String with enum values: dropdown
  if (dataType === "string" && enumValues && enumValues.length > 0) {
    return (
      <div className="relative">
        <select
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="appearance-none w-full rounded-md border border-border bg-background px-2.5 py-1.5 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
        >
          <option value="">— select —</option>
          {enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-muted-foreground">
          <svg
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>
      </div>
    );
  }

  // Default: text input
  return (
    <input
      type="text"
      value={(value as string) ?? ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="value"
      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
    />
  );
}
