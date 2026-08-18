import { describe, expect, it, vi } from "vite-plus/test";
import type { AgentHttpTool } from "@/features/ai/services/agent-http/tool-types";
import { createAgentHttpToolRegistry } from "@/features/ai/services/agent-http/tool-registry";

vi.mock("@/features/ai/services/agent-http/responses-client", () => {
  return {
    createAndParseResponses: vi.fn(),
    parseJsonObject: (value: string) => {
      try {
        const parsed = JSON.parse(value) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      } catch {
        return {};
      }
    },
  };
});

describe("agent http tool loop", () => {
  it("executes function calls then returns the final message", async () => {
    const { createAndParseResponses } = await import(
      "@/features/ai/services/agent-http/responses-client"
    );
    const { runAgentHttpToolLoop } = await import(
      "@/features/ai/services/agent-http/agent-tool-loop"
    );

    const mockedCreate = vi.mocked(createAndParseResponses);
    mockedCreate
      .mockResolvedValueOnce({
        responseId: "resp_1",
        status: "completed",
        text: "",
        functionCalls: [
          {
            callId: "call_1",
            name: "echo",
            arguments: "{\"value\":\"hello\"}",
          },
        ],
        raw: null,
      })
      .mockResolvedValueOnce({
        responseId: "resp_2",
        status: "completed",
        text: "Tool finished",
        functionCalls: [],
        raw: null,
      });

    const echoTool: AgentHttpTool = {
      name: "echo",
      description: "Echo",
      kind: "other",
      permission: "none",
      parameters: {
        type: "object",
        properties: { value: { type: "string" } },
        required: ["value"],
      },
      execute: async (args) => ({ ok: true, output: args }),
    };

    const chunks: string[] = [];
    const toolNames: string[] = [];
    let completed = false;

    await runAgentHttpToolLoop({
      modelId: "grok-4.5",
      messages: [{ role: "user", content: "echo hello" }],
      apiKey: "test-key",
      mode: "agent",
      projectRoot: "/tmp/project",
      registry: createAgentHttpToolRegistry([echoTool]),
      remoteMcpServers: [],
      skills: [],
      handlers: {
        onChunk: (chunk) => chunks.push(chunk),
        onComplete: () => {
          completed = true;
        },
        onError: () => {
          throw new Error("should not error");
        },
        onToolUse: (event) => {
          toolNames.push(event.toolName);
        },
      },
    });

    expect(toolNames).toEqual(["echo"]);
    expect(chunks.join("")).toBe("Tool finished");
    expect(completed).toBe(true);
    expect(mockedCreate).toHaveBeenCalledTimes(2);

    const secondCall = mockedCreate.mock.calls[1]?.[0];
    expect(secondCall?.previousResponseId).toBe("resp_1");
    expect(secondCall?.input).toEqual([
      {
        type: "function_call_output",
        call_id: "call_1",
        output: JSON.stringify({ value: "hello" }),
      },
    ]);
  });
});
