import type { ChatMode } from "@/features/ai/types/ai-chat-store.types";
import type { AcpEvent } from "@/features/ai/types/acp.types";
import type { RemoteMcpServerConfig } from "@/features/ai/types/mcp.types";
import type { AIMessage } from "@/features/ai/types/messages.types";
import type { AIChatSkill } from "@/features/ai/types/skills.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import {
  createAndParseResponses,
  parseJsonObject,
  type CreateResponsesParams,
} from "./responses-client";
import type { ParsedResponsesTurn } from "./responses-types";
import { createBuiltinAgentHttpTools } from "./builtin-tools";
import {
  clearHttpPermissionRequests,
  registerHttpPermissionRequest,
} from "./http-permission-bridge";
import { getAgentHttpModeCapabilities } from "./mode-capabilities";
import { toResponsesMcpTools } from "./mcp-remote-tools";
import { createSkillAgentHttpTools } from "./skill-tools";
import { createAgentHttpToolRegistry, type AgentHttpToolRegistry } from "./tool-registry";
import type {
  AgentHttpFunctionCallOutput,
  AgentHttpPermissionRequest,
  AgentHttpToolContext,
  ResponsesToolDefinition,
} from "./tool-types";

const DEFAULT_MAX_TOOL_ITERATIONS = 8;

export type AgentHttpToolLoopHandlers = {
  onChunk: (chunk: string) => void;
  onComplete: () => void;
  onError: (error: string, canReconnect?: boolean) => void;
  onToolUse?: (event: Extract<AcpEvent, { type: "tool_start" }>) => void;
  onToolUpdate?: (event: Extract<AcpEvent, { type: "tool_update" }>) => void;
  onToolComplete?: (toolName: string, toolId?: string, output?: unknown, error?: string) => void;
  onPermissionRequest?: (
    event: Extract<AcpEvent, { type: "permission_request" }>,
  ) => void | Promise<void>;
};

export type AgentHttpToolLoopParams = {
  modelId: string;
  messages: AIMessage[];
  apiKey: string;
  mode: ChatMode;
  projectRoot?: string | null;
  maxOutputTokens?: number;
  temperature?: number;
  maxToolIterations?: number;
  registry?: AgentHttpToolRegistry;
  skills?: AIChatSkill[];
  remoteMcpServers?: RemoteMcpServerConfig[];
  signal?: AbortSignal;
  useTauriFetch?: boolean;
  handlers: AgentHttpToolLoopHandlers;
  requestPermission?: (request: AgentHttpPermissionRequest) => Promise<boolean>;
};

function stringifyToolOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output ?? null);
  } catch {
    return String(output);
  }
}

export function buildAgentHttpRegistry(params: {
  mode: ChatMode;
  skills?: AIChatSkill[];
  includeBuiltins?: boolean;
}): AgentHttpToolRegistry {
  const capabilities = getAgentHttpModeCapabilities(params.mode);
  const tools = [];

  if (params.includeBuiltins ?? capabilities.allowBuiltinTools) {
    tools.push(...createBuiltinAgentHttpTools());
  }

  if (capabilities.allowSkillTools) {
    tools.push(...createSkillAgentHttpTools(params.skills || []));
  }

  return createAgentHttpToolRegistry(tools);
}

export async function buildAgentHttpResponsesTools(params: {
  mode: ChatMode;
  registry: AgentHttpToolRegistry;
  remoteMcpServers?: RemoteMcpServerConfig[];
}): Promise<ResponsesToolDefinition[]> {
  const capabilities = getAgentHttpModeCapabilities(params.mode);
  const tools: ResponsesToolDefinition[] = [...params.registry.toResponsesTools(params.mode)];

  if (capabilities.allowRemoteMcp) {
    tools.push(...(await toResponsesMcpTools(params.remoteMcpServers)));
  }

  return tools;
}

export function getDefaultAgentHttpToolRegistry(mode: ChatMode = "agent"): AgentHttpToolRegistry {
  const settings = useSettingsStore.getState().settings;
  return buildAgentHttpRegistry({
    mode,
    skills: settings.aiSkills,
  });
}

export async function runAgentHttpToolLoop(params: AgentHttpToolLoopParams): Promise<void> {
  const {
    modelId,
    messages,
    apiKey,
    mode,
    projectRoot,
    maxOutputTokens,
    temperature,
    signal,
    useTauriFetch,
    handlers,
  } = params;

  const settings = useSettingsStore.getState().settings;
  const skills = params.skills ?? settings.aiSkills;
  const remoteMcpServers = params.remoteMcpServers ?? settings.aiRemoteMcpServers;
  const capabilities = getAgentHttpModeCapabilities(mode);

  const registry =
    params.registry ??
    buildAgentHttpRegistry({
      mode,
      skills,
    });

  const tools = await buildAgentHttpResponsesTools({
    mode,
    registry,
    remoteMcpServers,
  });
  const maxIterations = params.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;

  if (tools.length === 0) {
    // Ask-only chat without skills/MCP configured should fall back to completions.
    throw new Error("No Responses tools available for this mode");
  }

  let previousResponseId: string | undefined;
  let nextInput: CreateResponsesParams["input"] | undefined;
  let nextMessages: AIMessage[] | undefined = messages;
  let emittedText = false;

  const defaultRequestPermission = async (
    request: AgentHttpPermissionRequest,
  ): Promise<boolean> => {
    if (!handlers.onPermissionRequest) {
      return false;
    }

    return await new Promise<boolean>((resolve) => {
      registerHttpPermissionRequest(request.requestId, resolve);
      void handlers.onPermissionRequest?.({
        type: "permission_request",
        requestId: request.requestId,
        permissionType: request.permissionType,
        resource: request.resource,
        description: request.description,
        options: [
          { id: "reject", name: "Deny", kind: "reject_once" },
          { id: "allow", name: "Allow", kind: "allow_once" },
        ],
      });
    });
  };

  const toolContext: AgentHttpToolContext = {
    projectRoot,
    mode,
    signal,
    requestPermission: params.requestPermission || defaultRequestPermission,
  };

  try {
    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (signal?.aborted) {
        throw new Error("Cancelled");
      }

      let requestError: string | null = null;
      const turn: ParsedResponsesTurn = await createAndParseResponses(
        {
          model: modelId,
          messages: nextMessages,
          input: nextInput,
          tools,
          previousResponseId,
          maxOutputTokens,
          temperature,
          apiKey,
          stream: true,
          store: true,
          parallelToolCalls: true,
          signal,
          useTauriFetch,
        },
        {
          onTextDelta: (delta) => {
            if (!delta) return;
            emittedText = true;
            handlers.onChunk(delta);
          },
          onError: (error) => {
            requestError = error;
          },
        },
      );

      if (requestError) {
        throw new Error(requestError);
      }

      if (!turn.responseId && turn.functionCalls.length === 0 && !turn.text) {
        throw new Error("Empty Responses result");
      }

      previousResponseId = turn.responseId || previousResponseId;

      if (turn.functionCalls.length === 0) {
        if (!emittedText && turn.text) {
          handlers.onChunk(turn.text);
        }
        handlers.onComplete();
        return;
      }

      // Server-managed MCP calls appear in output but don't need local execution.
      // Only client-side function_call items are returned by extractFunctionCalls.
      const toolOutputs: AgentHttpFunctionCallOutput[] = [];

      for (const call of turn.functionCalls) {
        const args = parseJsonObject(call.arguments);
        const sessionId = turn.responseId || "agent-http";

        handlers.onToolUse?.({
          type: "tool_start",
          sessionId,
          toolName: call.name,
          toolId: call.callId,
          input: args,
          kind: registry.get(call.name)?.kind || "other",
          status: "in_progress",
          locations: [],
        });

        const result = await registry.execute(
          call.name,
          { ...args, __tool_id: call.callId },
          toolContext,
        );

        handlers.onToolUpdate?.({
          type: "tool_update",
          sessionId,
          toolId: call.callId,
          toolName: call.name,
          input: args,
          output: result.output,
          kind: registry.get(call.name)?.kind || "other",
          status: result.ok ? "completed" : "failed",
          locations: result.locations || [],
          error: result.error || null,
        });

        handlers.onToolComplete?.(
          call.name,
          call.callId,
          result.ok ? result.output : undefined,
          result.ok ? undefined : result.error,
        );

        toolOutputs.push({
          type: "function_call_output",
          call_id: call.callId,
          output: stringifyToolOutput(
            result.ok
              ? result.output
              : {
                  error: result.error || "Tool failed",
                },
          ),
        });
      }

      nextMessages = undefined;
      nextInput = toolOutputs;
    }

    throw new Error(`Tool loop exceeded ${maxIterations} iterations`);
  } finally {
    clearHttpPermissionRequests(false);
    void capabilities;
  }
}

export function shouldUseAgentHttpResponses(params: {
  providerId: string;
  mode: ChatMode;
  supportsResponses?: boolean;
  supportsTools?: boolean;
  toolsEnabled?: boolean;
  hasSkillTools?: boolean;
  hasRemoteMcp?: boolean;
}): boolean {
  if (params.toolsEnabled === false) return false;
  if (params.providerId !== "grok") return false;
  if (params.supportsResponses !== true) return false;

  const capabilities = getAgentHttpModeCapabilities(params.mode);
  if (!capabilities.useResponses) return false;

  const hasLocalTools =
    (capabilities.allowBuiltinTools && params.supportsTools === true) ||
    (capabilities.allowSkillTools && params.hasSkillTools === true);
  const hasRemoteMcp = capabilities.allowRemoteMcp && params.hasRemoteMcp === true;

  return hasLocalTools || hasRemoteMcp;
}
