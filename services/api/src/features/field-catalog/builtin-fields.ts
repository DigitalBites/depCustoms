export const BUILTIN_FIELDS = [
  {
    canonical_ref: "asset.ecosystem",
    label: "Ecosystem",
    data_type: "string",
    description: "npm | pypi",
    operators: ["eq", "ne", "in", "not_in"],
  },
  {
    canonical_ref: "asset.package",
    label: "Package Name",
    data_type: "string",
    description: "The package name",
    operators: ["eq", "ne", "contains", "starts_with", "ends_with"],
  },
  {
    canonical_ref: "asset.version",
    label: "Package Version",
    data_type: "string",
    description: "The version string",
    operators: ["eq", "ne", "contains"],
  },
  {
    canonical_ref: "asset.version_published_at",
    label: "Version Published At",
    data_type: "datetime",
    description:
      "UTC ISO 8601 publish timestamp for the requested package version, when known",
    operators: ["gt", "gte", "lt", "lte", "exists", "not_exists"],
  },
  {
    canonical_ref: "asset.version_age_days",
    label: "Version Age Days",
    data_type: "float",
    description:
      "Age of the requested package version in days, when the publish timestamp is known",
    operators: ["gt", "gte", "lt", "lte", "exists", "not_exists"],
  },
  {
    canonical_ref: "asset.latest_version_published_at",
    label: "Latest Version Published At",
    data_type: "datetime",
    description:
      "UTC ISO 8601 publish timestamp for the latest known package version, when known",
    operators: ["gt", "gte", "lt", "lte", "exists", "not_exists"],
  },
  {
    canonical_ref: "runtime.request_timestamp",
    label: "Request Timestamp",
    data_type: "datetime",
    description: "UTC ISO 8601 of the current request",
    operators: ["gt", "gte", "lt", "lte"],
  },
] as const;

export const BUILTIN_FIELD_REFS: ReadonlySet<string> = new Set(
  BUILTIN_FIELDS.map((field) => field.canonical_ref),
);
