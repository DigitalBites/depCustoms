const MCP_PROTOCOL_VERSION = "2025-11-25";

type McpInitializeProjectContext = {
  accessibleProjects: Array<{ id: string; name: string }>;
  defaultProject: { id: string; name: string } | null;
};

export function getMcpProtocolVersion(): string {
  return MCP_PROTOCOL_VERSION;
}

export function buildInitializeResult(
  projectContext: McpInitializeProjectContext = {
    accessibleProjects: [],
    defaultProject: null,
  },
) {
  return {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {
      tools: {
        listChanged: false,
      },
    },
    serverInfo: {
      name: "customs-mcp",
      version: "0.1.0",
    },
    _meta: {
      customs: {
        accessible_projects: projectContext.accessibleProjects,
        default_project: projectContext.defaultProject,
      },
    },
  };
}
