import { z } from "zod";
import semver from "semver";
import {
  optionalStringQuerySchema,
  paginationQuerySchema,
  syncScopeQuerySchema,
} from "../../http/validation.js";

export const findingsQuerySchema = paginationQuerySchema(50, 200).extend({
  connector_key: optionalStringQuerySchema,
  status: optionalStringQuerySchema,
  severity: optionalStringQuerySchema,
});

export const pagedPackagesQuerySchema = paginationQuerySchema(50, 200);

export const connectorSyncQuerySchema = z.object({
  scope: syncScopeQuerySchema,
});

export const contributorPackagesQuerySchema = paginationQuerySchema(
  50,
  200,
).extend({
  score_tier: z.enum(["LOW", "MEDIUM", "HIGH", "NONE"]).optional(),
  min_score: z.coerce.number().int().min(0).max(100).optional(),
});

export const contributorPublishersQuerySchema = paginationQuerySchema(
  50,
  200,
).extend({
  ecosystem: optionalStringQuerySchema,
  only_first_time: z.coerce.boolean().optional(),
});

type VersionRow = {
  ecosystem: string;
  name: string;
  version: string;
};

type FixCandidate = {
  ecosystem: string;
  name: string;
  version: string;
  fix_version: string;
};

export function calculateFixNotAppliedSet(
  fixCandidates: FixCandidate[],
  projectVersions: VersionRow[],
): Set<string> {
  const versionMap = new Map<string, string[]>();
  for (const row of projectVersions) {
    const key = `${row.ecosystem}|${row.name}`;
    const list = versionMap.get(key) ?? [];
    list.push(row.version);
    versionMap.set(key, list);
  }

  const fixNotAppliedSet = new Set<string>();
  for (const candidate of fixCandidates) {
    if (!candidate.fix_version) continue;

    const key = `${candidate.ecosystem}|${candidate.name}`;
    const pulledVersions = versionMap.get(key) ?? [];

    const resolved =
      candidate.ecosystem === "npm"
        ? pulledVersions.some((version) => {
            const cleanVersion = semver.valid(semver.coerce(version));
            const cleanFix = semver.valid(semver.coerce(candidate.fix_version));
            return (
              cleanVersion && cleanFix && semver.gte(cleanVersion, cleanFix)
            );
          })
        : pulledVersions.includes(candidate.fix_version);

    if (!resolved) {
      fixNotAppliedSet.add(
        `${candidate.ecosystem}|${candidate.name}|${candidate.version}`,
      );
    }
  }

  return fixNotAppliedSet;
}
