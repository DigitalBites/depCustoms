import { useCallback, useEffect, useMemo, useState } from "react";
import { getUserErrorMessage } from "@/lib/api-error";
import { getValidUuidParam } from "@/lib/route-params";
import {
  fetchViolationDetail,
  fetchViolations,
  fetchViolationsSummary,
  updateBulkViolationStatus,
  updateFindingStatus,
  updateViolationStatus,
} from "@/features/violations/api";
import type {
  EnrichedViolation,
  ExpansionData,
  SeverityFilter,
  StatusFilter,
  ViolationWithFindings,
  ViolationsSummary,
} from "@/features/violations/types";

const LIMIT = 50;

export function useViolationDetail(violationId: string | null) {
  const [violation, setViolation] = useState<ViolationWithFindings | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const loadViolation = useCallback(async () => {
    if (!violationId) {
      setError("Invalid violation identifier.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await fetchViolationDetail(violationId);
      setViolation(data.violation);
    } catch (err) {
      setError(getUserErrorMessage(err, "Failed to load violation"));
    } finally {
      setLoading(false);
    }
  }, [violationId]);

  useEffect(() => {
    void loadViolation();
  }, [loadViolation]);

  async function setStatus(status: "resolved" | "suppressed", note: string) {
    if (!violationId) {
      setUpdateError("Invalid violation identifier.");
      return false;
    }

    setUpdating(true);
    setUpdateError(null);
    try {
      const data = await updateViolationStatus(violationId, status, note);
      setViolation(data.violation);
      return true;
    } catch (err) {
      setUpdateError(getUserErrorMessage(err, "Failed to update status"));
      return false;
    } finally {
      setUpdating(false);
    }
  }

  return {
    violation,
    loading,
    error,
    loadViolation,
    updating,
    updateError,
    setStatus,
  };
}

export function useViolationId(rawViolationId: string) {
  return getValidUuidParam(rawViolationId);
}

export function useViolationsPanelData(input: {
  tenantId: string;
  projectId?: string;
  policyId?: string;
  ruleId?: string;
  shouldShowSummary: boolean;
}) {
  const { tenantId, projectId, policyId, ruleId, shouldShowSummary } = input;
  const [summary, setSummary] = useState<ViolationsSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(shouldShowSummary);
  const [violations, setViolations] = useState<EnrichedViolation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open");
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [entityFilter, setEntityFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expansionCache, setExpansionCache] = useState<
    Record<string, ExpansionData>
  >({});
  const [loadingExpansion, setLoadingExpansion] = useState<string | null>(null);
  const [expansionErrors, setExpansionErrors] = useState<
    Record<string, string>
  >({});
  const [selectedViolationIds, setSelectedViolationIds] = useState<string[]>(
    [],
  );
  const [bulkNote, setBulkNote] = useState("");
  const [bulkActing, setBulkActing] = useState<
    "resolved" | "suppressed" | null
  >(null);

  useEffect(() => {
    if (!shouldShowSummary) return;

    setSummaryLoading(true);
    fetchViolationsSummary({ tenantId, projectId })
      .then((data) => setSummary(data))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false));
  }, [tenantId, projectId, shouldShowSummary]);

  const loadViolations = useCallback(
    async (nextOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchViolations({
          tenantId,
          projectId,
          policyId,
          ruleId,
          limit: LIMIT,
          offset: nextOffset,
          statusFilter,
          severityFilter,
          entityFilter,
        });

        if (nextOffset === 0) {
          setViolations(data.violations);
        } else {
          setViolations((prev) => [...prev, ...data.violations]);
        }
        setHasMore(data.violations.length === LIMIT);
        setOffset(nextOffset);
      } catch (err) {
        setError(getUserErrorMessage(err, "Failed to load violations"));
      } finally {
        setLoading(false);
      }
    },
    [
      tenantId,
      projectId,
      policyId,
      ruleId,
      statusFilter,
      severityFilter,
      entityFilter,
    ],
  );

  useEffect(() => {
    void loadViolations(0);
  }, [loadViolations]);

  const visibleViolationIds = useMemo(
    () => violations.map((violation) => violation.id),
    [violations],
  );
  const selectedVisibleCount = useMemo(
    () =>
      visibleViolationIds.filter((id) => selectedViolationIds.includes(id))
        .length,
    [selectedViolationIds, visibleViolationIds],
  );
  const allVisibleSelected =
    visibleViolationIds.length > 0 &&
    selectedVisibleCount === visibleViolationIds.length;
  const hasPartialVisibleSelection =
    selectedVisibleCount > 0 &&
    selectedVisibleCount < visibleViolationIds.length;

  useEffect(() => {
    setSelectedViolationIds((prev) => {
      const next = prev.filter((id) => visibleViolationIds.includes(id));
      return next.length === prev.length ? prev : next;
    });
  }, [visibleViolationIds]);

  async function handleExpand(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (expansionCache[id]) return;
    setLoadingExpansion(id);
    try {
      const data = await fetchViolationDetail(id);
      const violation = data.violation;
      setExpansionCache((prev) => ({
        ...prev,
        [id]: {
          findings: violation.findings ?? [],
          findingSchemas: violation.findingSchemas ?? {},
          field_values_at_evaluation:
            violation.field_values_at_evaluation ?? {},
        },
      }));
    } catch (err) {
      setExpansionErrors((prev) => ({
        ...prev,
        [id]: getUserErrorMessage(err, "Failed to load details"),
      }));
    } finally {
      setLoadingExpansion(null);
    }
  }

  async function handleViolationStatus(
    violationId: string,
    status: "resolved" | "suppressed",
    note: string,
  ) {
    const data = await updateViolationStatus(violationId, status, note);
    const updated = data.violation;

    setViolations((prev) =>
      prev.map((violation) =>
        violation.id === violationId
          ? {
              ...violation,
              status: updated.status,
              status_note: updated.status_note ?? null,
            }
          : violation,
      ),
    );

    setExpansionCache((prev) => ({
      ...prev,
      [violationId]: {
        findings: updated.findings ?? [],
        findingSchemas: updated.findingSchemas ?? {},
        field_values_at_evaluation: updated.field_values_at_evaluation ?? {},
      },
    }));
  }

  async function handleBulkViolationStatus(status: "resolved" | "suppressed") {
    if (selectedViolationIds.length === 0) return;

    setBulkActing(status);
    setError(null);
    try {
      const data = await updateBulkViolationStatus({
        violationIds: selectedViolationIds,
        status,
        note: bulkNote,
      });

      const updatedIds = new Set(data.updated_ids);
      setViolations((prev) =>
        prev.map((violation) =>
          updatedIds.has(violation.id)
            ? {
                ...violation,
                status,
                status_note: bulkNote.trim() || null,
              }
            : violation,
        ),
      );

      setExpansionCache((prev) => {
        const next = { ...prev };
        for (const violationId of data.updated_ids) {
          delete next[violationId];
        }
        return next;
      });

      setSelectedViolationIds([]);
      setBulkNote("");
    } catch (err) {
      setError(
        getUserErrorMessage(err, "Failed to update selected violations"),
      );
    } finally {
      setBulkActing(null);
    }
  }

  async function handleFindingStatus(
    findingId: string,
    status: "resolved" | "suppressed" | "open",
    note: string,
  ) {
    const expandedViolation = expandedId
      ? violations.find((violation) => violation.id === expandedId)
      : null;
    if (!expandedViolation) return;

    await updateFindingStatus({
      projectId: expandedViolation.project_id,
      findingId,
      status,
      note,
    });

    const data = await fetchViolationDetail(expandedViolation.id);
    const violation = data.violation;
    setExpansionCache((prev) => ({
      ...prev,
      [expandedViolation.id]: {
        findings: violation.findings ?? [],
        findingSchemas: violation.findingSchemas ?? {},
        field_values_at_evaluation: violation.field_values_at_evaluation ?? {},
      },
    }));
  }

  function toggleViolationSelection(violationId: string) {
    setSelectedViolationIds((prev) =>
      prev.includes(violationId)
        ? prev.filter((id) => id !== violationId)
        : [...prev, violationId],
    );
  }

  function toggleAllVisibleViolations() {
    setSelectedViolationIds((prev) => {
      if (allVisibleSelected) {
        return prev.filter((id) => !visibleViolationIds.includes(id));
      }

      return Array.from(new Set([...prev, ...visibleViolationIds]));
    });
  }

  return {
    summary,
    summaryLoading,
    violations,
    loading,
    error,
    statusFilter,
    setStatusFilter,
    severityFilter,
    setSeverityFilter,
    entityFilter,
    setEntityFilter,
    offset,
    hasMore,
    expandedId,
    expansionCache,
    loadingExpansion,
    expansionErrors,
    selectedViolationIds,
    setSelectedViolationIds,
    bulkNote,
    setBulkNote,
    bulkActing,
    allVisibleSelected,
    hasPartialVisibleSelection,
    loadViolations,
    handleExpand,
    handleViolationStatus,
    handleBulkViolationStatus,
    handleFindingStatus,
    toggleViolationSelection,
    toggleAllVisibleViolations,
  };
}
