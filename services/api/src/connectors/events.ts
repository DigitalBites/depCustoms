import { randomUUID } from "node:crypto";
import type { ArtifactIdentity } from "../features/packages/artifact-identity.js";
import type {
  ConnectorArtifactEvent,
  ConnectorArtifactRequestEvent,
  ConnectorEventContext,
  ConnectorEventKind,
  ConnectorEventSubscription,
  ConnectorPackageMetadataEvent,
  EntityContext,
  PackageIntelligenceConnector,
} from "./types.js";

export function buildArtifactRequestEvent(input: {
  artifactIdentity: Pick<
    ArtifactIdentity,
    | "package_id"
    | "package_version_id"
    | "ecosystem"
    | "package"
    | "version"
  >;
  source: ConnectorArtifactRequestEvent["source"];
  context?: ConnectorEventContext;
}): ConnectorArtifactRequestEvent {
  const { artifactIdentity, source, context } = input;
  if (!artifactIdentity.package_id || !artifactIdentity.package_version_id) {
    throw new Error("artifact_identity_missing_catalog_ids");
  }
  if (!artifactIdentity.version) {
    throw new Error("artifact_identity_missing_version");
  }

  return {
    id: randomUUID(),
    kind: "artifact_request",
    packageId: artifactIdentity.package_id,
    packageVersionId: artifactIdentity.package_version_id,
    ecosystem: artifactIdentity.ecosystem,
    packageName: artifactIdentity.package,
    version: artifactIdentity.version,
    source,
    observedAt: new Date().toISOString(),
    ...(context ? { context } : {}),
  };
}

export function buildPackageMetadataEvent(input: {
  artifactIdentity: Pick<
    ArtifactIdentity,
    "package_id" | "ecosystem" | "package"
  >;
  source: ConnectorPackageMetadataEvent["source"];
  context?: ConnectorEventContext;
}): ConnectorPackageMetadataEvent {
  const { artifactIdentity, source, context } = input;
  if (!artifactIdentity.package_id) {
    throw new Error("artifact_identity_missing_package_id");
  }

  return {
    id: randomUUID(),
    kind: "package_metadata",
    packageId: artifactIdentity.package_id,
    packageVersionId: null,
    ecosystem: artifactIdentity.ecosystem,
    packageName: artifactIdentity.package,
    version: null,
    source,
    observedAt: new Date().toISOString(),
    ...(context ? { context } : {}),
  };
}

export function connectorSupportsEvent(
  connector: PackageIntelligenceConnector,
  event: ConnectorArtifactEvent,
): boolean {
  return (
    getConnectorSubscription(connector, event.kind) !== null &&
    connectorSupportsEcosystem(connector, event.ecosystem) &&
    connector.supportsEvent(event)
  );
}

export function getConnectorSubscription(
  connector: PackageIntelligenceConnector,
  kind: ConnectorEventKind,
): ConnectorEventSubscription | null {
  return (
    connector.subscribedEvents.find((subscription) => subscription.kind === kind) ??
    null
  );
}

function connectorSupportsEcosystem(
  connector: PackageIntelligenceConnector,
  ecosystem: string,
): boolean {
  return (
    connector.supportedEcosystems === "all" ||
    connector.supportedEcosystems.includes(ecosystem.toLowerCase())
  );
}

export function eventEntityContext(
  event: ConnectorArtifactEvent,
  displayName: string,
  input: {
    isCacheHit: boolean;
    responseTimeMs: number;
    cacheAgeHours: number | null;
  },
): EntityContext {
  return {
    packageId: event.packageId,
    packageVersionId: event.packageVersionId,
    ecosystem: event.ecosystem,
    pkg: event.packageName,
    version: event.version,
    displayName,
    ...input,
  };
}
