export function formatViolationSummary(input: {
  now: Date;
  statusRows: { status: string; count: string }[];
  severityRows: { severity: string; count: string }[];
  blockedRows: { blocked: boolean; count: string }[];
  thisWeekRow: { count: string }[];
  priorWeekRow: { count: string }[];
  suppressionRow: { count: string }[];
}) {
  const statusMap = new Map(
    input.statusRows.map((row) => [row.status, Number(row.count)]),
  );
  const statusCounts = {
    open: statusMap.get("open") ?? 0,
    resolved: statusMap.get("resolved") ?? 0,
    suppressed: statusMap.get("suppressed") ?? 0,
  };

  const severityMap = new Map(
    input.severityRows.map((row) => [
      row.severity.toLowerCase(),
      Number(row.count),
    ]),
  );
  const severityCounts = {
    critical: severityMap.get("critical") ?? 0,
    high: severityMap.get("high") ?? 0,
    medium: severityMap.get("medium") ?? 0,
    low: severityMap.get("low") ?? 0,
  };

  const blockedMap = new Map(
    input.blockedRows.map((row) => [String(row.blocked), Number(row.count)]),
  );
  const thisWeek = Number(input.thisWeekRow[0]?.count ?? 0);
  const priorWeek = Number(input.priorWeekRow[0]?.count ?? 0);

  return {
    statusCounts,
    severityCounts,
    blockedCount: blockedMap.get("true") ?? 0,
    advisoryCount: blockedMap.get("false") ?? 0,
    trend: { thisWeek, priorWeek, delta: thisWeek - priorWeek },
    activeSuppressionsCount: Number(input.suppressionRow[0]?.count ?? 0),
    computedAt: input.now.toISOString(),
  };
}
