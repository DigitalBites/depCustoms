import type { ReactNode } from "react";
import { CopyField } from "@/components/ui/copy-field";

export interface SecretRevealField {
  label: string;
  value: string;
  sensitive?: boolean;
  separator?: "=" | ":";
  labelWidthClass?: string;
}

export function SecretRevealCard({
  message,
  fields,
  dismissLabel,
  onDismiss,
}: {
  message: ReactNode;
  fields: SecretRevealField[];
  dismissLabel: string;
  onDismiss: () => void;
}) {
  return (
    <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
      <p className="mb-3 text-sm font-medium text-amber-800 dark:text-amber-300">
        {message}
      </p>
      <div className="space-y-2">
        {fields.map((field) => (
          <CopyField
            key={field.label}
            label={field.label}
            value={field.value}
            sensitive={field.sensitive}
            separator={field.separator}
            labelWidthClass={field.labelWidthClass}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 text-xs text-amber-700 underline dark:text-amber-400"
      >
        {dismissLabel}
      </button>
    </div>
  );
}
