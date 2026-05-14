import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { getTableName, isTable } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../../db/schema.js";
import { violations } from "../../db/schema.js";

describe("drizzle config", () => {
  it("includes every API schema table in the runtime push filter", async () => {
    const configTables = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          "tsx",
          "-e",
          "const cfg = await import('./drizzle.config.ts'); console.log(JSON.stringify(cfg.API_SCHEMA_TABLES));",
        ],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            DATABASE_URL: "postgres://user:pass@localhost:5432/customs",
          },
          encoding: "utf8",
        },
      ),
    ) as string[];

    const schemaTables = Object.values(schema)
      .filter((value) => isTable(value))
      .map((table) => getTableName(table))
      .sort();

    expect(configTables.sort()).toEqual(schemaTables);
  });

  it("keeps generated schema identifiers within Postgres limits", () => {
    const files = [
      {
        path: "drizzle/0000_init.sql",
        pattern: /(?:CONSTRAINT|INDEX|TABLE) "([^"]+)"/g,
      },
      {
        path: "drizzle/meta/0000_snapshot.json",
        pattern: /"name": "([^"]+)"/g,
      },
    ];
    const longIdentifiers: string[] = [];

    for (const file of files) {
      const text = readFileSync(file.path, "utf8");
      let match: RegExpExecArray | null;
      while ((match = file.pattern.exec(text))) {
        const identifier = match[1] ?? "";
        if (Buffer.byteLength(identifier, "utf8") > 63) {
          longIdentifiers.push(identifier);
        }
      }
    }

    expect([...new Set(longIdentifiers)].sort()).toEqual([]);
  });

  it("uses generated key columns for the active violations index", () => {
    const index = getTableConfig(violations).indexes.find(
      (candidate) => candidate.config.name === "violations_active_package_idx",
    );

    expect(
      index?.config.columns.map((column) =>
        "name" in column ? column.name : null,
      ),
    ).toEqual([
      "tenant_id",
      "project_id",
      "entity_type",
      "package_id_key",
      "package_version_id_key",
      "policy_id_key",
      "rule_id_key",
      "policy_rule_binding_id_key",
      "policy_project_binding_id_key",
      "enforcement_mode",
      "code",
    ]);

    const whereChunks =
      index?.config.where?.queryChunks
        .map((chunk) =>
          chunk && "value" in chunk && Array.isArray(chunk.value)
            ? chunk.value.join("")
            : "",
        )
        .join("") ?? null;

    expect(whereChunks).toBe(
      "(status = ANY (ARRAY['open'::text, 'suppressed'::text]))",
    );
  });
});
