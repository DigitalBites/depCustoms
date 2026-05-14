import { describe, expect, it } from "vitest";

import {
  buildArtifactRequestEvent,
  buildPackageMetadataEvent,
} from "../../connectors/events.js";

describe("connector event identity boundaries", () => {
  it("builds artifact events from API-resolved catalog IDs", () => {
    const event = buildArtifactRequestEvent({
      artifactIdentity: {
        package_id: "pkg-pypi-my-pkg",
        package_version_id: "pkgver-pypi-my-pkg-1.0.0",
        ecosystem: "pypi",
        package: "my-pkg",
        version: "1.0.0",
      },
      source: "proxy",
    });

    expect(event).toEqual(
      expect.objectContaining({
        kind: "artifact_request",
        packageId: "pkg-pypi-my-pkg",
        packageVersionId: "pkgver-pypi-my-pkg-1.0.0",
        ecosystem: "pypi",
        packageName: "my-pkg",
        version: "1.0.0",
      }),
    );
  });

  it("rejects artifact events that do not have resolved catalog IDs", () => {
    expect(() =>
      buildArtifactRequestEvent({
        artifactIdentity: {
          package_id: "pkg-1",
          package_version_id: null,
          ecosystem: "npm",
          package: "lodash",
          version: "4.17.15",
        },
        source: "proxy",
      }),
    ).toThrow("artifact_identity_missing_catalog_ids");
  });

  it("builds package-scoped metadata events without version identity", () => {
    const event = buildPackageMetadataEvent({
      artifactIdentity: {
        package_id: "pkg-pypi-my-pkg",
        ecosystem: "pypi",
        package: "my-pkg",
      },
      source: "sync",
    });

    expect(event).toEqual(
      expect.objectContaining({
        kind: "package_metadata",
        packageId: "pkg-pypi-my-pkg",
        packageVersionId: null,
        packageName: "my-pkg",
        version: null,
      }),
    );
  });
});
