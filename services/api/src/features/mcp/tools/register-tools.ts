import { mcpToolRegistry } from "../tool-registry.js";
import {
  getEffectivePoliciesToolDefinition,
  handleGetEffectivePoliciesTool,
} from "./get-effective-policies.js";
import {
  explainPackageDecisionToolDefinition,
  handleExplainPackageDecisionTool,
} from "./explain-package-decision.js";
import {
  handleListRecentlyBlockedPackagesTool,
  listRecentlyBlockedPackagesToolDefinition,
} from "./list-recently-blocked-packages.js";
import {
  handleListProjectPackagesTool,
  listProjectPackagesToolDefinition,
} from "./list-project-packages.js";
import {
  getProjectSecuritySummaryToolDefinition,
  handleGetProjectSecuritySummaryTool,
} from "./get-project-security-summary.js";
import {
  handleListProjectFindingsTool,
  listProjectFindingsToolDefinition,
} from "./list-project-findings.js";
import {
  handleListProjectViolationsTool,
  listProjectViolationsToolDefinition,
} from "./list-project-violations.js";
import {
  handleSuggestAllowedVersionsTool,
  suggestAllowedVersionsToolDefinition,
} from "./suggest-allowed-versions.js";
import {
  handlePreviewDependencyChangeTool,
  previewDependencyChangeToolDefinition,
} from "./preview-dependency-change.js";
import {
  getProjectDependencyContextToolDefinition,
  handleGetProjectDependencyContextTool,
} from "./get-project-dependency-context.js";
import {
  getProjectContributorSummaryToolDefinition,
  handleGetProjectContributorSummaryTool,
} from "./get-project-contributor-summary.js";
import {
  handleListVulnerablePackagesTool,
  listVulnerablePackagesToolDefinition,
} from "./list-vulnerable-packages.js";
import {
  findProjectsUsingPackageToolDefinition,
  handleFindProjectsUsingPackageTool,
} from "./find-projects-using-package.js";
import {
  handleListProjectContributorPackagesTool,
  listProjectContributorPackagesToolDefinition,
} from "./list-project-contributor-packages.js";

let registered = false;

export function registerMcpTools(): void {
  if (registered) return;

  mcpToolRegistry.register(
    getEffectivePoliciesToolDefinition,
    handleGetEffectivePoliciesTool,
  );
  mcpToolRegistry.register(
    explainPackageDecisionToolDefinition,
    handleExplainPackageDecisionTool,
  );
  mcpToolRegistry.register(
    listRecentlyBlockedPackagesToolDefinition,
    handleListRecentlyBlockedPackagesTool,
  );
  mcpToolRegistry.register(
    listProjectPackagesToolDefinition,
    handleListProjectPackagesTool,
  );
  mcpToolRegistry.register(
    getProjectSecuritySummaryToolDefinition,
    handleGetProjectSecuritySummaryTool,
  );
  mcpToolRegistry.register(
    getProjectContributorSummaryToolDefinition,
    handleGetProjectContributorSummaryTool,
  );
  mcpToolRegistry.register(
    listProjectFindingsToolDefinition,
    handleListProjectFindingsTool,
  );
  mcpToolRegistry.register(
    listProjectViolationsToolDefinition,
    handleListProjectViolationsTool,
  );
  mcpToolRegistry.register(
    suggestAllowedVersionsToolDefinition,
    handleSuggestAllowedVersionsTool,
  );
  mcpToolRegistry.register(
    previewDependencyChangeToolDefinition,
    handlePreviewDependencyChangeTool,
  );
  mcpToolRegistry.register(
    getProjectDependencyContextToolDefinition,
    handleGetProjectDependencyContextTool,
  );
  mcpToolRegistry.register(
    listProjectContributorPackagesToolDefinition,
    handleListProjectContributorPackagesTool,
  );
  mcpToolRegistry.register(
    listVulnerablePackagesToolDefinition,
    handleListVulnerablePackagesTool,
  );
  mcpToolRegistry.register(
    findProjectsUsingPackageToolDefinition,
    handleFindProjectsUsingPackageTool,
  );

  registered = true;
}
