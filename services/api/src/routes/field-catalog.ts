/**
 * Field catalog and operator routes — C.
 *
 * GET /v1/field-catalog               — all registered connector fields (with optional filters)
 * GET /v1/connectors/:key/fields      — fields for a specific connector
 * GET /v1/operators                   — all supported operators with metadata
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../db/index.js";
import { connector_fields } from "../db/schema.js";
import { authMiddleware } from "../middleware/auth.js";
import {
  connectorKeyParamSchema,
  optionalBooleanQuerySchema,
  optionalStringQuerySchema,
} from "../http/validation.js";

export const fieldCatalogRouter = new Hono();
fieldCatalogRouter.use("*", authMiddleware);

const fieldCatalogQuerySchema = z.object({
  connector_key: optionalStringQuerySchema,
  entity_type: optionalStringQuerySchema,
  deprecated: optionalBooleanQuerySchema,
});

const connectorFieldsQuerySchema = z.object({
  deprecated: optionalBooleanQuerySchema,
});

// ---------------------------------------------------------------------------
// Operator definitions — source of truth for the rule builder UI.
// ---------------------------------------------------------------------------
const OPERATORS = [
  {
    id: "eq",
    label: "equals",
    applicable_types: ["integer", "float", "boolean", "string", "datetime"],
  },
  {
    id: "ne",
    label: "not equals",
    applicable_types: ["integer", "float", "boolean", "string", "datetime"],
  },
  {
    id: "gt",
    label: "greater than",
    applicable_types: ["integer", "float", "datetime"],
  },
  {
    id: "gte",
    label: "greater than or equal",
    applicable_types: ["integer", "float", "datetime"],
  },
  {
    id: "lt",
    label: "less than",
    applicable_types: ["integer", "float", "datetime"],
  },
  {
    id: "lte",
    label: "less than or equal",
    applicable_types: ["integer", "float", "datetime"],
  },
  {
    id: "in",
    label: "is one of",
    applicable_types: ["string"],
    value_type: "array",
    note: "value must be an array",
  },
  {
    id: "not_in",
    label: "is not one of",
    applicable_types: ["string"],
    value_type: "array",
    note: "value must be an array",
  },
  { id: "contains", label: "contains", applicable_types: ["string"] },
  {
    id: "not_contains",
    label: "does not contain",
    applicable_types: ["string"],
  },
  { id: "starts_with", label: "starts with", applicable_types: ["string"] },
  { id: "ends_with", label: "ends with", applicable_types: ["string"] },
  {
    id: "is_true",
    label: "is true",
    applicable_types: ["boolean"],
    note: "no value required",
  },
  {
    id: "is_false",
    label: "is false",
    applicable_types: ["boolean"],
    note: "no value required",
  },
  {
    id: "exists",
    label: "exists (is not null)",
    applicable_types: ["integer", "float", "boolean", "string", "datetime"],
    note: "no value required",
  },
  {
    id: "not_exists",
    label: "does not exist (is null)",
    applicable_types: ["integer", "float", "boolean", "string", "datetime"],
    note: "no value required",
  },
] as const;

// Built-in fields (not stored in connector_fields — resolved at eval time)
const BUILTIN_FIELDS = [
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
    canonical_ref: "runtime.request_timestamp",
    label: "Request Timestamp",
    data_type: "datetime",
    description: "UTC ISO 8601 of the current request",
    operators: ["gt", "gte", "lt", "lte"],
  },
];

// ---------------------------------------------------------------------------
// GET /v1/field-catalog
// ---------------------------------------------------------------------------
fieldCatalogRouter.get(
  "/v1/field-catalog",
  zValidator("query", fieldCatalogQuerySchema),
  async (c) => {
    const connectorKey = c.req.valid("query").connector_key;
    const entityType = c.req.valid("query").entity_type;
    const showDeprecated = c.req.valid("query").deprecated;

    const conditions = [];
    if (connectorKey)
      conditions.push(eq(connector_fields.connector_key, connectorKey));
    if (entityType)
      conditions.push(eq(connector_fields.entity_type, entityType));
    if (!showDeprecated)
      conditions.push(eq(connector_fields.deprecated, false));

    const rows = await db
      .select()
      .from(connector_fields)
      .where(
        conditions.length > 0
          ? and(
              ...(conditions as [
                ReturnType<typeof eq>,
                ...ReturnType<typeof eq>[],
              ]),
            )
          : undefined,
      );

    return c.json({
      connector_fields: rows,
      builtin_fields: BUILTIN_FIELDS,
    });
  },
);

// ---------------------------------------------------------------------------
// GET /v1/connectors/:key/fields
// ---------------------------------------------------------------------------
fieldCatalogRouter.get(
  "/v1/connectors/:key/fields",
  zValidator("query", connectorFieldsQuerySchema),
  async (c) => {
    const parsedConnectorKey = connectorKeyParamSchema.safeParse(
      c.req.param("key"),
    );
    if (!parsedConnectorKey.success) {
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "Connector key is invalid",
            detail: null,
          },
        },
        400,
      );
    }
    const connectorKey = parsedConnectorKey.data;
    const showDeprecated = c.req.valid("query").deprecated;

    const rows = await db
      .select()
      .from(connector_fields)
      .where(
        and(
          eq(connector_fields.connector_key, connectorKey),
          ...(showDeprecated ? [] : [eq(connector_fields.deprecated, false)]),
        ),
      );

    if (rows.length === 0) {
      // Could be a valid connector with no fields yet, or an unknown key — return empty
      return c.json({ connector_key: connectorKey, fields: [] });
    }

    return c.json({ connector_key: connectorKey, fields: rows });
  },
);

// ---------------------------------------------------------------------------
// GET /v1/operators
// ---------------------------------------------------------------------------
fieldCatalogRouter.get("/v1/operators", (c) => {
  return c.json({ operators: OPERATORS });
});
