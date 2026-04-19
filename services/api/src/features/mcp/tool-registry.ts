import type { McpRequestContext } from "./context.js";

export type McpToolDefinition = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
};

export type McpToolHandler = (
  ctx: McpRequestContext,
  params: unknown,
) => Promise<unknown>;

export class McpToolExecutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolExecutionError";
  }
}

export class McpToolRegistry {
  private readonly tools = new Map<
    string,
    { definition: McpToolDefinition; handler: McpToolHandler }
  >();

  register(definition: McpToolDefinition, handler: McpToolHandler): void {
    this.tools.set(definition.name, { definition, handler });
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(
    name: string,
    ctx: McpRequestContext,
    params: unknown,
  ): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown MCP tool: ${name}`);
    }

    return tool.handler(ctx, params);
  }

  listTools(): McpToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => tool.definition);
  }
}

export const mcpToolRegistry = new McpToolRegistry();
