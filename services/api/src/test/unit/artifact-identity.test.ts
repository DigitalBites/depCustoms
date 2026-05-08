import { describe, expect, it, vi } from "vitest";

import {
  buildArtifactCanonicalRef,
  buildArtifactDisplayName,
  buildArtifactIdentity,
  resolveArtifactIdentities,
} from "../../features/packages/artifact-identity.js";
import { q } from "../helpers/fakes.js";

function makeDb() {
  const insert = vi.fn();
  insert
    .mockReturnValueOnce(
      q([
        { id: "pkg-npm-scope/pkg", ecosystem: "npm", package: "@scope/pkg" },
        { id: "pkg-pypi-my-pkg", ecosystem: "pypi", package: "my-pkg" },
      ]),
    )
    .mockReturnValueOnce(
      q([
        {
          id: "pkgver-npm-scope/pkg-1.2.3",
          package_id: "pkg-npm-scope/pkg",
          version: "1.2.3",
        },
      ]),
    );

  return { insert };
}

describe("artifact identity", () => {
  it("builds package-version identity with raw and normalized values", () => {
    const identity = buildArtifactIdentity(
      {
        ecosystem: " NPM ",
        package: " @Scope/Pkg ",
        version: " 1.2.3 ",
        source: "unit_test",
      },
      {
        package_id: "pkg-1",
        package_version_id: "pkgver-1",
      },
    );

    expect(identity).toMatchObject({
      ecosystem: "npm",
      package: "@scope/pkg",
      version: "1.2.3",
      scope: "package_version",
      package_id: "pkg-1",
      package_version_id: "pkgver-1",
      canonical_ref: "npm:@scope/pkg:1.2.3",
      display_name: "npm:@scope/pkg@1.2.3",
      raw: {
        ecosystem: " NPM ",
        package: " @Scope/Pkg ",
        version: " 1.2.3 ",
        source: "unit_test",
        parser_version: "artifact-identity-v1",
      },
    });
  });

  it("builds package-scoped identity when version is absent", () => {
    const identity = buildArtifactIdentity({
      ecosystem: "pypi",
      package: "My_Pkg.Name",
      version: null,
    });

    expect(identity).toMatchObject({
      ecosystem: "pypi",
      package: "my-pkg-name",
      version: null,
      scope: "package",
      canonical_ref: "pypi:my-pkg-name",
      display_name: "pypi:my-pkg-name",
      package_id: null,
      package_version_id: null,
    });
  });

  it("derives refs without treating them as persistence identity", () => {
    const packageIdentity = {
      ecosystem: "npm",
      package: "lodash",
      version: null,
    };
    const versionIdentity = {
      ecosystem: "npm",
      package: "lodash",
      version: "4.17.21",
    };

    expect(buildArtifactCanonicalRef(packageIdentity)).toBe("npm:lodash");
    expect(buildArtifactCanonicalRef(versionIdentity)).toBe(
      "npm:lodash:4.17.21",
    );
    expect(buildArtifactDisplayName(packageIdentity)).toBe("npm:lodash");
    expect(buildArtifactDisplayName(versionIdentity)).toBe(
      "npm:lodash@4.17.21",
    );
  });

  it("resolves catalog references for mixed package and package-version inputs", async () => {
    const identities = await resolveArtifactIdentities(makeDb() as any, [
      {
        ecosystem: "npm",
        package: "@scope/pkg",
        version: "1.2.3",
        source: "record_usage",
      },
      {
        ecosystem: "PyPI",
        package: "My_Pkg",
        version: null,
        source: "connector_package_scope",
      },
    ]);

    expect(identities).toEqual([
      expect.objectContaining({
        ecosystem: "npm",
        package: "@scope/pkg",
        version: "1.2.3",
        scope: "package_version",
        package_id: "pkg-npm-scope/pkg",
        package_version_id: "pkgver-npm-scope/pkg-1.2.3",
      }),
      expect.objectContaining({
        ecosystem: "pypi",
        package: "my-pkg",
        version: null,
        scope: "package",
        package_id: "pkg-pypi-my-pkg",
        package_version_id: null,
      }),
    ]);
  });
});
