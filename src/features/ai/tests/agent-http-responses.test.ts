import { describe, expect, it } from "vite-plus/test";
import {
  athasMessagesToResponsesInput,
  extractFunctionCalls,
  extractOutputText,
  parseCompletedResponsesObject,
} from "@/features/ai/services/agent-http/responses-types";
import { buildResponsesPayload } from "@/features/ai/services/agent-http/responses-client";
import {
  createAgentHttpToolRegistry,
  shouldUseAgentHttpResponses,
} from "@/features/ai/services/agent-http";
import { createBuiltinAgentHttpTools } from "@/features/ai/services/agent-http/builtin-tools";
import { createSkillAgentHttpTools } from "@/features/ai/services/agent-http/skill-tools";
import { toResponsesMcpTools } from "@/features/ai/services/agent-http/mcp-remote-tools";
import { getAgentHttpModeCapabilities } from "@/features/ai/services/agent-http/mode-capabilities";

describe("agent http responses helpers", () => {
  it("converts Athas messages into Responses instructions + input", () => {
    const result = athasMessagesToResponsesInput([
      { role: "system", content: "You are Athas Agent." },
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this image" },
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,abc", detail: "high" },
          },
        ],
      },
    ]);

    expect(result.instructions).toBe("You are Athas Agent.");
    expect(result.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: "Inspect this image" },
          {
            type: "input_image",
            image_url: { url: "data:image/png;base64,abc", detail: "high" },
            detail: "high",
          },
        ],
      },
    ]);
  });

  it("builds a Responses payload with tools and previous_response_id", () => {
    const payload = buildResponsesPayload({
      model: "grok-4.5",
      apiKey: "test",
      messages: [
        { role: "system", content: "Be helpful." },
        { role: "user", content: "Read package.json" },
      ],
      tools: [
        {
          type: "function",
          name: "read_file",
          description: "Read a file",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
      previousResponseId: "resp_123",
      maxOutputTokens: 1200,
      temperature: 0.2,
      stream: true,
    });

    expect(payload.model).toBe("grok-4.5");
    expect(payload.instructions).toBe("Be helpful.");
    expect(payload.previous_response_id).toBe("resp_123");
    expect(payload.tool_choice).toBe("auto");
    expect(payload.tools?.[0]).toMatchObject({
      type: "function",
      name: "read_file",
    });
    expect(payload.input).toEqual([{ role: "user", content: "Read package.json" }]);
  });

  it("extracts text and function calls from a completed response", () => {
    const turn = parseCompletedResponsesObject({
      id: "resp_abc",
      status: "completed",
      output: [
        {
          type: "function_call",
          call_id: "call_1",
          name: "read_file",
          arguments: "{\"path\":\"README.md\"}",
        },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Here is the file." }],
        },
      ],
    });

    expect(turn.responseId).toBe("resp_abc");
    expect(turn.text).toBe("Here is the file.");
    expect(extractOutputText(turn.raw?.output)).toBe("Here is the file.");
    expect(extractFunctionCalls(turn.raw?.output)).toEqual([
      {
        callId: "call_1",
        name: "read_file",
        arguments: "{\"path\":\"README.md\"}",
        id: undefined,
      },
    ]);
  });
});

describe("agent http tool registry", () => {
  it("applies mode matrix: chat ask-only, plan read-only, agent full tools", () => {
    const registry = createAgentHttpToolRegistry(createBuiltinAgentHttpTools());
    const chatTools = registry.toResponsesTools("chat").map((tool) => tool.name);
    const planTools = registry.toResponsesTools("plan").map((tool) => tool.name);
    const agentTools = registry.toResponsesTools("agent").map((tool) => tool.name);

    expect(chatTools).not.toContain("read_file");
    expect(chatTools).not.toContain("apply_file_edit");

    expect(planTools).toContain("read_file");
    expect(planTools).toContain("list_dir");
    expect(planTools).toContain("search_files");
    expect(planTools).toContain("get_open_buffers");
    expect(planTools).not.toContain("apply_file_edit");

    expect(agentTools).toContain("read_file");
    expect(agentTools).toContain("apply_file_edit");
  });

  it("executes tools and returns structured failures for unknown tools", async () => {
    const registry = createAgentHttpToolRegistry([
      {
        name: "echo",
        description: "Echo args",
        kind: "other",
        permission: "none",
        parameters: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
        execute: async (args) => ({ ok: true, output: args }),
      },
    ]);

    const ok = await registry.execute(
      "echo",
      { value: "hi" },
      { mode: "chat", projectRoot: "/tmp/project" },
    );
    expect(ok).toEqual({ ok: true, output: { value: "hi" } });

    const missing = await registry.execute("nope", {}, { mode: "chat" });
    expect(missing.ok).toBe(false);
    expect(missing.error).toContain("Unknown tool");
  });

  it("creates skill tools and remote MCP tool declarations", async () => {
    const skillTools = createSkillAgentHttpTools([
      {
        id: "skill-1",
        title: "Refactor Helper",
        description: "Helps refactor code",
        content: "Always prefer small safe refactors.",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);
    expect(skillTools[0]?.name.startsWith("skill_")).toBe(true);

    const mcpTools = await toResponsesMcpTools([
      {
        id: "mcp-1",
        label: "deepwiki",
        url: "https://mcp.deepwiki.com/mcp",
        enabled: true,
        description: "Docs MCP",
      },
      {
        id: "mcp-2",
        label: "disabled",
        url: "https://example.com/mcp",
        enabled: false,
      },
    ]);
    expect(mcpTools).toEqual([
      {
        type: "mcp",
        server_url: "https://mcp.deepwiki.com/mcp",
        server_label: "deepwiki",
        server_description: "Docs MCP",
      },
    ]);
  });

  it("exposes the intended mode capability matrix", () => {
    expect(getAgentHttpModeCapabilities("chat")).toEqual({
      useResponses: true,
      allowBuiltinTools: false,
      allowWriteTools: false,
      allowSkillTools: true,
      allowRemoteMcp: true,
    });
    expect(getAgentHttpModeCapabilities("plan").allowBuiltinTools).toBe(true);
    expect(getAgentHttpModeCapabilities("plan").allowWriteTools).toBe(false);
    expect(getAgentHttpModeCapabilities("agent").allowWriteTools).toBe(true);
  });

  it("only enables Responses tools for Grok when mode capabilities are present", () => {
    expect(
      shouldUseAgentHttpResponses({
        providerId: "grok",
        mode: "agent",
        supportsResponses: true,
        supportsTools: true,
      }),
    ).toBe(true);

    expect(
      shouldUseAgentHttpResponses({
        providerId: "grok",
        mode: "chat",
        supportsResponses: true,
        supportsTools: true,
        hasSkillTools: true,
      }),
    ).toBe(true);

    expect(
      shouldUseAgentHttpResponses({
        providerId: "grok",
        mode: "chat",
        supportsResponses: true,
        supportsTools: true,
      }),
    ).toBe(false);

    expect(
      shouldUseAgentHttpResponses({
        providerId: "openai",
        mode: "agent",
        supportsResponses: true,
        supportsTools: true,
      }),
    ).toBe(false);

    expect(
      shouldUseAgentHttpResponses({
        providerId: "grok",
        mode: "agent",
        supportsResponses: true,
        supportsTools: true,
        toolsEnabled: false,
      }),
    ).toBe(false);
  });
});
