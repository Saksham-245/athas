import type { AcpToolCallLocation, AcpToolKind } from "@/features/ai/types/acp.types";
import type { ChatMode } from "@/features/ai/types/ai-chat-store.types";

export type JsonSchema = {
  type?: string | string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean | null>;
  additionalProperties?: boolean | JsonSchema;
  default?: unknown;
  [key: string]: unknown;
};

export type AgentHttpToolPermission = "none" | "write" | "execute";

export type AgentHttpToolMode = "chat" | "plan" | "agent" | "all";

export type ResponsesFunctionToolDefinition = {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchema;
};

export type ResponsesMcpToolDefinition = {
  type: "mcp";
  server_url: string;
  server_label: string;
  server_description?: string;
  allowed_tools?: string[];
  authorization?: string;
  headers?: Record<string, string>;
};

export type ResponsesToolDefinition =
  | ResponsesFunctionToolDefinition
  | ResponsesMcpToolDefinition;

export type AgentHttpToolResult = {
  ok: boolean;
  output: unknown;
  error?: string;
  locations?: AcpToolCallLocation[];
};

export type AgentHttpPermissionRequest = {
  requestId: string;
  permissionType: string;
  resource: string;
  description: string;
  toolName: string;
  toolId: string;
  input: unknown;
};

export type AgentHttpToolContext = {
  projectRoot?: string | null;
  mode: ChatMode;
  signal?: AbortSignal;
  requestPermission?: (request: AgentHttpPermissionRequest) => Promise<boolean>;
};

export type AgentHttpTool = {
  name: string;
  description: string;
  kind: AcpToolKind;
  permission: AgentHttpToolPermission;
  /** Which chat modes may use this tool. Defaults to all. */
  modes?: AgentHttpToolMode[];
  parameters: JsonSchema;
  execute: (args: Record<string, unknown>, context: AgentHttpToolContext) => Promise<AgentHttpToolResult>;
};

export type AgentHttpFunctionCall = {
  type: "function_call";
  callId: string;
  name: string;
  arguments: string;
  id?: string;
};

export type AgentHttpFunctionCallOutput = {
  type: "function_call_output";
  call_id: string;
  output: string;
};