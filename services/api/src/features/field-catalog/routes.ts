/**
 * Field catalog and operator routes.
 */

import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "../../db/index.js";
import { connector_fields } from "../../db/schema.js";
import { authMiddleware } from "../../middleware/auth.js";
import { errorJson } from "../../http/responses.js";
import {
  connectorKeyParamSchema,
  optionalBooleanQuerySchema,
  optionalStringQuerySchema,
} from "../../http/validation.js";
import { BUILTIN_FIELDS } from "./builtin-fields.js";

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

fieldCatalogRouter.get(
  "/v1/field-catalog",
  zValidator("query", fieldCatalogQuerySchema),
  async (c) => {
    const connectorKey = c.req.valid("query").connector_key;
    const entityType = c.req.valid("query").entity_type;
    const showDeprecated = c.req.valid("query").deprecated;

    const conditions = [];
    if (connectorKey) {
      conditions.push(eq(connector_fields.connector_key, connectorKey));
    }
    if (entityType) {
      conditions.push(eq(connector_fields.entity_type, entityType));
    }
    if (!showDeprecated) {
      conditions.push(eq(connector_fields.deprecated, false));
    }

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

fieldCatalogRouter.get(
  "/v1/connectors/:key/fields",
  zValidator("query", connectorFieldsQuerySchema),
  async (c) => {
    const parsedConnectorKey = connectorKeyParamSchema.safeParse(
      c.req.param("key"),
    );
    if (!parsedConnectorKey.success) {
      return errorJson(c, 400, "BAD_REQUEST", "Connector key is invalid");
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

    return c.json({ connector_fields: rows });
  },
);

fieldCatalogRouter.get("/v1/operators", (c) => {
  return c.json({ operators: OPERATORS });
});
