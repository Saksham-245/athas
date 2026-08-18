import type { ChatMode } from "@/features/ai/types/ai-chat-store.types";
import type { AgentHttpTool, AgentHttpToolMode } from "./tool-types";

export type AgentHttpModeCapabilities = {
  /** Use Responses API instead of Chat Completions. */
  useResponses: boolean;
  /** Include local filesystem/search/buffer tools. */
  allowBuiltinTools: boolean;
  /** Include write/edit/execute tools (requires Agent mode). */
  allowWriteTools: boolean;
  /** Expose installed skills as invocable tools. */
  allowSkillTools: boolean;
  /** Attach configured remote MCP servers. */
  allowRemoteMcp: boolean;
};

export function getAgentHttpModeCapabilities(mode: ChatMode): AgentHttpModeCapabilities {
  switch (mode) {
    case "agent":
      return {
        useResponses: true,
        allowBuiltinTools: true,
        allowWriteTools: true,
        allowSkillTools: true,
        allowRemoteMcp: true,
      };
    case "plan":
      return {
        useResponses: true,
        allowBuiltinTools: true,
        allowWriteTools: false,
        allowSkillTools: true,
        allowRemoteMcp: false,
      };
    case "chat":
    default:
      return {
        useResponses: true,
        allowBuiltinTools: false,
        allowWriteTools: false,
        allowSkillTools: true,
        allowRemoteMcp: true,
      };
  }
}

export function isReadOnlyTool(tool: AgentHttpTool): boolean {
  return (
    tool.permission === "none" &&
    (tool.kind === "read" || tool.kind === "search" || tool.kind === "think" || tool.kind === "other")
  );
}

export function toolAllowedInMode(tool: AgentHttpTool, mode: ChatMode): boolean {
  const capabilities = getAgentHttpModeCapabilities(mode);
  const modes: AgentHttpToolMode[] =
    tool.modes && tool.modes.length > 0 ? tool.modes : ["all"];

  if (!(modes.includes("all") || modes.includes(mode))) {
    return false;
  }

  if (tool.permission !== "none") {
    return capabilities.allowWriteTools;
  }

  if (tool.name.startsWith("skill_")) {
    return capabilities.allowSkillTools;
  }

  // Builtin project tools are opt-in by mode.
  if (
    tool.name === "read_file" ||
    tool.name === "list_dir" ||
    tool.name === "search_files" ||
    tool.name === "get_open_buffers" ||
    tool.name === "apply_file_edit"
  ) {
    if (!capabilities.allowBuiltinTools) return false;
    if (tool.permission !== "none" && !capabilities.allowWriteTools) return false;
    return true;
  }

  if (!capabilities.allowBuiltinTools && !capabilities.allowSkillTools) {
    return false;
  }

  if (mode === "plan" && !isReadOnlyTool(tool)) {
    return false;
  }

  return true;
}
