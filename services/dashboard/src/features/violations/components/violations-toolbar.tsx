import {
  SEVERITIES,
  VIOLATION_STATUS,
  VIOLATION_STATUSES,
} from "@customs/shared-constants";
import type { WritableViolationStatus } from "@customs/shared-constants";
import type { SeverityFilter, StatusFilter } from "@/features/violations/types";

export function ViolationsFilters({
  statusFilter,
  setStatusFilter,
  severityFilter,
  setSeverityFilter,
  entityFilter,
  setEntityFilter,
}: {
  statusFilter: StatusFilter;
  setStatusFilter: (value: StatusFilter) => void;
  severityFilter: SeverityFilter;
  setSeverityFilter: (value: SeverityFilter) => void;
  entityFilter: string;
  setEntityFilter: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex gap-1 border-b border-border">
        {(["all", ...VIOLATION_STATUSES] as StatusFilter[]).map((status) => (
            <button
              type="button"
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`border-b-2 px-3 py-1.5 text-sm font-medium transition-colors ${
                statusFilter === status
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {status === "all" ? "All statuses" : status}
            </button>
          ))}
      </div>

      <div className="flex gap-1">
        {(["all", ...SEVERITIES] as SeverityFilter[]).map((severity) => (
            <button
              type="button"
              key={severity}
              onClick={() => setSeverityFilter(severity)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                severityFilter === severity
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {severity === "all" ? "All severities" : severity}
            </button>
          ))}
      </div>

      <input
        type="text"
        value={entityFilter}
        onChange={(e) => setEntityFilter(e.target.value)}
        placeholder="Search by package (e.g. lodash)"
        className="w-64 rounded-md border border-border bg-background px-3 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      />
    </div>
  );
}

export function ViolationsBulkActions({
  visible,
  selectedCount,
  onClear,
  bulkNote,
  setBulkNote,
  bulkActing,
  onResolve,
  onSuppress,
}: {
  visible: boolean;
  selectedCount: number;
  onClear: () => void;
  bulkNote: string;
  setBulkNote: (value: string) => void;
  bulkActing: WritableViolationStatus | null;
  onResolve: () => void;
  onSuppress: () => void;
}) {
  if (!visible) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border/70 bg-card/80 px-3 py-2.5">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3 text-xs">
          <p className="font-medium text-foreground">
            {selectedCount} selected
          </p>
          <button
            type="button"
            onClick={onClear}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            Clear
          </button>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            value={bulkNote}
            onChange={(e) => setBulkNote(e.target.value)}
            placeholder="Optional note"
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary sm:w-64"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onResolve}
              disabled={bulkActing !== null}
              className="rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50"
            >
              {bulkActing === VIOLATION_STATUS.RESOLVED
                ? "Resolving…"
                : "Resolve"}
            </button>
            <button
              type="button"
              onClick={onSuppress}
              disabled={bulkActing !== null}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {bulkActing === VIOLATION_STATUS.SUPPRESSED
                ? "Suppressing…"
                : "Suppress"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
