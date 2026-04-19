"use client";

import { OPERATOR_LABELS } from "@/features/policies/types";

interface OperatorSelectorProps {
  value: string;
  operators: string[]; // list from the selected field's operators array
  onChange: (op: string) => void;
  disabled?: boolean;
}

export function OperatorSelector({
  value,
  operators,
  onChange,
  disabled,
}: OperatorSelectorProps) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || operators.length === 0}
        className="appearance-none w-full rounded-md border border-border bg-background px-2.5 py-1.5 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
      >
        <option value="">— operator —</option>
        {operators.map((op) => (
          <option key={op} value={op}>
            {OPERATOR_LABELS[op] ?? op}
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
