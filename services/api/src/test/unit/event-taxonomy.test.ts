import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DECISIONS,
  DECISION_PATHS,
  METADATA_CACHE_STATUSES,
  PROXY_STATUS_EVENT_TYPES,
  REQUEST_EVENT_SOURCES,
  REQUEST_EVENT_TYPES,
  SERVE_MODES,
} from "@customs/shared-constants";

type EventTaxonomyFixture = {
  requestEventSources: string[];
  requestEventTypes: string[];
  decisions: string[];
  decisionPaths: string[];
  serveModes: string[];
  metadataCacheStatuses: string[];
  proxyStatusEventTypes: string[];
};

describe("event taxonomy constants", () => {
  it("match the shared source taxonomy", async () => {
    const raw = await readFile("../shared/taxonomy/events.json", "utf8");
    const fixture = JSON.parse(raw) as EventTaxonomyFixture;

    expect([...REQUEST_EVENT_SOURCES]).toEqual(fixture.requestEventSources);
    expect([...REQUEST_EVENT_TYPES]).toEqual(fixture.requestEventTypes);
    expect([...DECISIONS]).toEqual(fixture.decisions);
    expect([...DECISION_PATHS]).toEqual(fixture.decisionPaths);
    expect([...SERVE_MODES]).toEqual(fixture.serveModes);
    expect([...METADATA_CACHE_STATUSES]).toEqual(
      fixture.metadataCacheStatuses,
    );
    expect([...PROXY_STATUS_EVENT_TYPES]).toEqual(
      fixture.proxyStatusEventTypes,
    );
  });
});
