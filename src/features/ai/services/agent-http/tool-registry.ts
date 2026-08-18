import type { ChatMode } from "@/features/ai/types/ai-chat-store.types";
import { toolAllowedInMode } from "./mode-capabilities";
import type {
  AgentHttpTool,
  AgentHttpToolContext,
  AgentHttpToolResult,
  ResponsesFunctionToolDefinition,
} from "./tool-types";

export class AgentHttpToolRegistry {
  private readonly tools = new Map<string, AgentHttpTool>();

  register(tool: AgentHttpTool): void {
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: AgentHttpTool[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  get(name: string): AgentHttpTool | undefined {
    return this.tools.get(name);
  }

  list(mode: ChatMode = "chat"): AgentHttpTool[] {
    return Array.from(this.tools.values()).filter((tool) => toolAllowedInMode(tool, mode));
  }

  toResponsesTools(mode: ChatMode = "chat"): ResponsesFunctionToolDefinition[] {
    return this.list(mode).map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    }));
  }

  async execute(
    name: string,
    rawArgs: unknown,
    context: AgentHttpToolContext,
  ): Promise<AgentHttpToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        ok: false,
        output: null,
        error: `Unknown tool: ${name}`,
      };
    }

    if (!toolAllowedInMode(tool, context.mode)) {
      return {
        ok: false,
        output: null,
        error: `Tool "${name}" is not available in ${context.mode} mode`,
      };
    }

    const raw =
      rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    const toolId = typeof raw.__tool_id === "string" ? raw.__tool_id : name;
    const { __tool_id: _ignoredToolId, ...args } = raw;
    void _ignoredToolId;

    if (tool.permission !== "none") {
      if (!context.requestPermission) {
        return {
          ok: false,
          output: null,
          error: `Tool "${name}" requires permission but no permission handler is available`,
        };
      }

      const approved = await context.requestPermission({
        requestId: `http-perm-${name}-${Date.now()}`,
        permissionType: tool.permission,
        resource:
          typeof args.path === "string"
            ? args.path
            : typeof args.command === "string"
              ? args.command
              : name,
        description: `${tool.description} (${name})`,
        toolName: name,
        toolId,
        input: args,
      });

      if (!approved) {
        return {
          ok: false,
          output: null,
          error: `Permission denied for tool "${name}"`,
        };
      }
    }

    try {
      return await tool.execute(args, context);
    } catch (error) {
      return {
        ok: false,
        output: null,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

export function createAgentHttpToolRegistry(tools: AgentHttpTool[] = []): AgentHttpToolRegistry {
  const registry = new AgentHttpToolRegistry();
  registry.registerAll(tools);
  return registry;
}