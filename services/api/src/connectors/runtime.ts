/**
 * Connector runtime registry — holds the live connector instances after startup.
 *
 * Connectors are built in index.ts (after DB is ready) and registered here via
 * setConnectors(). Routes that need connector access (e.g. policy-preview) call
 * getConnectors() rather than receiving connectors as constructor arguments.
 */

import type { PackageIntelligenceConnector } from "./types.js";

let _connectors: PackageIntelligenceConnector[] = [];

export function setConnectors(
  connectors: PackageIntelligenceConnector[],
): void {
  _connectors = connectors;
}

export function getConnectors(): PackageIntelligenceConnector[] {
  return _connectors;
}
