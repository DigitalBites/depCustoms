"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { CatalogField } from "@/features/policies/types";

interface FieldCatalogResponse {
  connector_fields: Array<{
    canonical_ref: string;
    label: string;
    data_type: string;
    operators: string[];
    description?: string;
    deprecated?: boolean;
    connector_key: string;
    field_key: string;
    enum_values?: string[] | null;
  }>;
  builtin_fields: Array<{
    canonical_ref: string;
    label: string;
    data_type: string;
    operators: string[];
    description?: string;
  }>;
}

// Derive a human-readable group label from the connector key.
function connectorGroupLabel(key: string): string {
  const labels: Record<string, string> = {
    osv: "OSV Vulnerability Scanner",
    _builtin: "Asset / Built-in",
  };
  return labels[key] ?? key;
}

// Fetches the field catalog once and caches it for the session.
let _catalogCache: CatalogField[] | null = null;

export async function loadFieldCatalog(): Promise<CatalogField[]> {
  if (_catalogCache) return _catalogCache;

  const data = (await apiFetch("/v1/field-catalog")) as FieldCatalogResponse;

  const fields: CatalogField[] = [
    ...data.builtin_fields.map((f) => ({
      canonical_ref: f.canonical_ref,
      label: f.label,
      data_type: f.data_type as CatalogField["data_type"],
      operators: f.operators,
      description: f.description,
      group_label: "Asset / Built-in",
    })),
    ...data.connector_fields.map((f) => ({
      canonical_ref: f.canonical_ref,
      label: f.label,
      data_type: f.data_type as CatalogField["data_type"],
      operators: f.operators,
      description: f.description,
      deprecated: f.deprecated,
      enum_values: f.enum_values ?? undefined,
      group_label: f.field_key.startsWith("_meta.")
        ? `${connectorGroupLabel(f.connector_key)} — Connector Health`
        : connectorGroupLabel(f.connector_key),
    })),
  ];

  _catalogCache = fields;
  return fields;
}

interface FieldSelectorProps {
  value: string;
  onChange: (field: CatalogField | null) => void;
  disabled?: boolean;
}

export function FieldSelector({
  value,
  onChange,
  disabled,
}: FieldSelectorProps) {
  const [fields, setFields] = useState<CatalogField[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadFieldCatalog()
      .then(setFields)
      .finally(() => setLoading(false));
  }, []);

  // Group fields by group_label for <optgroup>
  const groups = fields.reduce<Record<string, CatalogField[]>>((acc, f) => {
    (acc[f.group_label] ??= []).push(f);
    return acc;
  }, {});

  function handleChange(ref: string) {
    const found = fields.find((f) => f.canonical_ref === ref) ?? null;
    onChange(found);
  }

  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        disabled={disabled || loading}
        className="appearance-none w-full rounded-md border border-border bg-background px-2.5 py-1.5 pr-8 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
      >
        <option value="">
          {loading ? "Loading fields…" : "— select field —"}
        </option>
        {Object.entries(groups).map(([groupLabel, groupFields]) => (
          <optgroup key={groupLabel} label={groupLabel}>
            {groupFields.map((f) => (
              <option
                key={f.canonical_ref}
                value={f.canonical_ref}
                disabled={f.deprecated}
              >
                {f.label}
                {f.deprecated ? " (deprecated)" : ""}
              </option>
            ))}
          </optgroup>
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
