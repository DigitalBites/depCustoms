import test from "node:test";
import assert from "node:assert/strict";

import { getProjectDisplayName } from "@/lib/project-metadata";

test("getProjectDisplayName returns the canonical project name when present", () => {
  assert.equal(
    getProjectDisplayName(
      [
        { id: "p_1", name: "Alpha" },
        { id: "p_2", name: "Beta" },
      ],
      "p_2",
    ),
    "Beta",
  );
});

test("getProjectDisplayName falls back when the project is missing", () => {
  assert.equal(getProjectDisplayName([], "p_missing"), "Project");
});
