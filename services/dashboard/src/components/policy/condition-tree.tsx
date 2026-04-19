"use client";

import { FieldSelector, loadFieldCatalog } from "./field-selector";
import { OperatorSelector } from "./operator-selector";
import { ValueInput } from "./value-input";
import { useEffect, useState } from "react";
import { NO_VALUE_OPERATORS } from "@/features/policies/types";
import type {
  Condition,
  CatalogField,
  LeafCondition,
} from "@/features/policies/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isGroup(
  c: Condition,
): c is { all: Condition[] } | { any: Condition[] } {
  return "all" in c || "any" in c;
}

function isNot(c: Condition): c is { not: Condition } {
  return "not" in c;
}

function isLeaf(c: Condition): c is LeafCondition {
  return "field" in c;
}

function emptyLeaf(): LeafCondition {
  return { field: "", operator: "", value: undefined };
}

function emptyGroup(): Condition {
  return { all: [] };
}

// ---------------------------------------------------------------------------
// Leaf node
// ---------------------------------------------------------------------------

function LeafNode({
  value,
  onChange,
  onDelete,
  fields,
  depth,
}: {
  value: LeafCondition;
  onChange: (v: LeafCondition) => void;
  onDelete: () => void;
  fields: CatalogField[];
  depth: number;
}) {
  const selectedField =
    fields.find((f) => f.canonical_ref === value.field) ?? null;

  function handleFieldChange(field: CatalogField | null) {
    onChange({
      field: field?.canonical_ref ?? "",
      operator: "",
      value: undefined,
    });
  }

  function handleOperatorChange(op: string) {
    const noVal = NO_VALUE_OPERATORS.has(op);
    onChange({
      ...value,
      operator: op,
      value: noVal ? undefined : value.value,
    });
  }

  function handleValueChange(val: unknown) {
    onChange({ ...value, value: val });
  }

  return (
    <div
      className={`flex flex-wrap items-start gap-2 rounded-md border border-border bg-card p-2 ${depth > 0 ? "ml-4" : ""}`}
    >
      {/* Field */}
      <div className="min-w-[180px] flex-1">
        <FieldSelector value={value.field} onChange={handleFieldChange} />
      </div>

      {/* Operator */}
      <div className="min-w-[140px] flex-1">
        <OperatorSelector
          value={value.operator}
          operators={selectedField?.operators ?? []}
          onChange={handleOperatorChange}
          disabled={!value.field}
        />
      </div>

      {/* Value */}
      <div className="min-w-[140px] flex-1">
        {value.operator && (
          <ValueInput
            operator={value.operator}
            dataType={selectedField?.data_type ?? "string"}
            enumValues={selectedField?.enum_values}
            value={value.value}
            onChange={handleValueChange}
          />
        )}
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        title="Remove condition"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NOT wrapper node
// ---------------------------------------------------------------------------

function NotNode({
  value,
  onChange,
  onDelete,
  fields,
  depth,
}: {
  value: { not: Condition };
  onChange: (v: Condition) => void;
  onDelete: () => void;
  fields: CatalogField[];
  depth: number;
}) {
  return (
    <div
      className={`rounded-md border border-border ${depth > 0 ? "ml-4" : ""}`}
    >
      <div className="flex items-center justify-between gap-2 rounded-t-md bg-muted/50 px-3 py-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          NOT
        </span>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors text-xs"
          title="Remove NOT wrapper"
        >
          ✕
        </button>
      </div>
      <div className="p-3">
        <ConditionNode
          value={value.not}
          onChange={(v) => onChange({ not: v })}
          onDelete={() => onChange(emptyLeaf())}
          fields={fields}
          depth={depth + 1}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Group node (AND / OR)
// ---------------------------------------------------------------------------

function GroupNode({
  value,
  onChange,
  onDelete,
  fields,
  depth,
}: {
  value: { all: Condition[] } | { any: Condition[] };
  onChange: (v: Condition) => void;
  onDelete?: () => void;
  fields: CatalogField[];
  depth: number;
}) {
  const type = "all" in value ? "all" : "any";
  const items = value[type as keyof typeof value] as Condition[];

  function update(newItems: Condition[]) {
    onChange({ [type]: newItems } as Condition);
  }

  function toggleType() {
    const newType = type === "all" ? "any" : "all";
    onChange({ [newType]: items } as Condition);
  }

  function updateChild(i: number, v: Condition) {
    const next = [...items];
    next[i] = v;
    update(next);
  }

  function deleteChild(i: number) {
    update(items.filter((_, idx) => idx !== i));
  }

  function addLeaf() {
    update([...items, emptyLeaf()]);
  }

  function addGroup() {
    update([...items, emptyGroup()]);
  }

  const borderColor =
    type === "all"
      ? "border-indigo-300 dark:border-indigo-700"
      : "border-emerald-300 dark:border-emerald-700";
  const labelColor =
    type === "all"
      ? "text-indigo-600 dark:text-indigo-400"
      : "text-emerald-600 dark:text-emerald-400";

  return (
    <div
      className={`rounded-md border-2 ${borderColor} ${depth > 0 ? "ml-4" : ""}`}
    >
      {/* Group header */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30 rounded-t">
        <button
          type="button"
          onClick={toggleType}
          className={`rounded px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide border ${
            type === "all"
              ? "border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 dark:border-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400"
              : "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400"
          } transition-colors`}
          title="Toggle AND / OR"
        >
          {type === "all" ? "AND" : "OR"}
        </button>
        <span className={`text-xs ${labelColor}`}>
          {type === "all"
            ? "all conditions must match"
            : "any condition must match"}
        </span>
        {onDelete && depth > 0 && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors text-xs"
            title="Remove group"
          >
            ✕
          </button>
        )}
      </div>

      {/* Children */}
      <div className="space-y-2 p-3">
        {items.length === 0 && (
          <p className="text-xs text-muted-foreground italic text-center py-2">
            No conditions — add one below
          </p>
        )}
        {items.map((child, i) => (
          <ConditionNode
            key={i}
            value={child}
            onChange={(v) => updateChild(i, v)}
            onDelete={() => deleteChild(i)}
            fields={fields}
            depth={depth + 1}
          />
        ))}

        {/* Add buttons */}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={addLeaf}
            className="rounded-md border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            + Add condition
          </button>
          <button
            type="button"
            onClick={addGroup}
            className="rounded-md border border-dashed border-border px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            + Add group
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic condition node dispatcher
// ---------------------------------------------------------------------------

function ConditionNode({
  value,
  onChange,
  onDelete,
  fields,
  depth,
}: {
  value: Condition;
  onChange: (v: Condition) => void;
  onDelete: () => void;
  fields: CatalogField[];
  depth: number;
}) {
  if (isNot(value)) {
    return (
      <NotNode
        value={value}
        onChange={onChange}
        onDelete={onDelete}
        fields={fields}
        depth={depth}
      />
    );
  }
  if (isGroup(value)) {
    return (
      <GroupNode
        value={value}
        onChange={onChange}
        onDelete={onDelete}
        fields={fields}
        depth={depth}
      />
    );
  }
  if (isLeaf(value)) {
    return (
      <LeafNode
        value={value}
        onChange={onChange}
        onDelete={onDelete}
        fields={fields}
        depth={depth}
      />
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public: ConditionTreeEditor
// ---------------------------------------------------------------------------

interface ConditionTreeEditorProps {
  value: Condition;
  onChange: (v: Condition) => void;
  readOnly?: boolean;
}

export function ConditionTreeEditor({
  value,
  onChange,
  readOnly,
}: ConditionTreeEditorProps) {
  const [fields, setFields] = useState<CatalogField[]>([]);

  useEffect(() => {
    loadFieldCatalog()
      .then(setFields)
      .catch(() => {});
  }, []);

  if (readOnly) {
    return (
      <div className="rounded-md border border-border bg-muted/20 p-3">
        <pre className="text-xs text-muted-foreground overflow-auto">
          {JSON.stringify(value, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <ConditionNode
        value={value}
        onChange={onChange}
        onDelete={() => onChange(emptyGroup())}
        fields={fields}
        depth={0}
      />
    </div>
  );
}
