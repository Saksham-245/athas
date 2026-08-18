import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type { AIMessage } from "@/features/ai/types/messages.types";
import {
  athasMessagesToResponsesInput,
  extractFunctionCalls,
  extractOutputText,
  parseCompletedResponsesObject,
  type ParsedResponsesTurn,
  type ResponsesCreateRequest,
  type ResponsesObject,
  type ResponsesOutputItem,
  type ResponsesStreamEvent,
} from "./responses-types";
import type { ResponsesToolDefinition } from "./tool-types";

export const XAI_RESPONSES_URL = "https://api.x.ai/v1/responses";

export type ResponsesStreamHandlers = {
  onTextDelta?: (delta: string) => void;
  onFunctionCall?: (call: {
    callId: string;
    name: string;
    arguments: string;
    id?: string;
  }) => void;
  onCompleted?: (turn: ParsedResponsesTurn) => void;
  onError?: (error: string) => void;
};

export type CreateResponsesParams = {
  model: string;
  messages?: AIMessage[];
  input?: ResponsesCreateRequest["input"];
  instructions?: string;
  tools?: ResponsesToolDefinition[];
  previousResponseId?: string;
  maxOutputTokens?: number;
  temperature?: number;
  apiKey: string;
  stream?: boolean;
  store?: boolean;
  parallelToolCalls?: boolean;
  signal?: AbortSignal;
  useTauriFetch?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildHeaders(apiKey: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

export function buildResponsesPayload(params: CreateResponsesParams): ResponsesCreateRequest {
  const fromMessages = params.messages
    ? athasMessagesToResponsesInput(params.messages)
    : { instructions: undefined, input: [] as ResponsesCreateRequest["input"] };

  const input = params.input ?? fromMessages.input;
  const instructions = params.instructions ?? fromMessages.instructions;

  const payload: ResponsesCreateRequest = {
    model: params.model,
    input,
    stream: params.stream ?? true,
    store: params.store ?? true,
    parallel_tool_calls: params.parallelToolCalls ?? true,
  };

  if (instructions) payload.instructions = instructions;
  if (params.tools && params.tools.length > 0) {
    payload.tools = params.tools;
    payload.tool_choice = "auto";
  }
  if (params.previousResponseId) payload.previous_response_id = params.previousResponseId;
  if (typeof params.maxOutputTokens === "number") {
    payload.max_output_tokens = params.maxOutputTokens;
  }
  if (typeof params.temperature === "number") {
    payload.temperature = params.temperature;
  }

  return payload;
}

export async function createResponsesRequest(
  params: CreateResponsesParams,
): Promise<Response> {
  const payload = buildResponsesPayload(params);
  const fetchFn = params.useTauriFetch ? tauriFetch : fetch;

  return fetchFn(XAI_RESPONSES_URL, {
    method: "POST",
    headers: buildHeaders(params.apiKey),
    body: JSON.stringify(payload),
    signal: params.signal,
  });
}

class ResponsesSSEParser {
  private buffer = "";
  private decoder = new TextDecoder();
  private text = "";
  private responseId: string | null = null;
  private status: ResponsesObject["status"] | null = null;
  private raw: ResponsesObject | null = null;
  private functionCalls = new Map<
    string,
    { callId: string; name: string; arguments: string; id?: string }
  >();
  private pendingByIndex = new Map<
    number,
    { callId?: string; name?: string; arguments: string; id?: string }
  >();
  private completed = false;

  constructor(private handlers: ResponsesStreamHandlers) {}

  async processStream(response: Response): Promise<ParsedResponsesTurn> {
    const reader = response.body?.getReader();
    if (!reader) {
      const error = "No response body reader available";
      this.handlers.onError?.(error);
      throw new Error(error);
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        this.buffer += this.decoder.decode(value, { stream: true });
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";

        for (const line of lines) {
          this.processLine(line);
        }
      }

      if (!this.completed) {
        this.completed = true;
        const turn = this.toTurn();
        this.handlers.onCompleted?.(turn);
        return turn;
      }

      return this.toTurn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.handlers.onError?.(message);
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private toTurn(): ParsedResponsesTurn {
    return {
      responseId: this.responseId,
      status: this.status,
      text: this.text,
      functionCalls: Array.from(this.functionCalls.values()),
      raw: this.raw,
    };
  }

  private upsertFunctionCall(call: {
    callId: string;
    name: string;
    arguments: string;
    id?: string;
  }) {
    const existing = this.functionCalls.get(call.callId);
    const next = {
      callId: call.callId,
      name: call.name || existing?.name || "unknown",
      arguments: call.arguments || existing?.arguments || "{}",
      id: call.id || existing?.id,
    };
    this.functionCalls.set(call.callId, next);
    this.handlers.onFunctionCall?.(next);
  }

  private absorbOutputItems(output: ResponsesOutputItem[] | undefined) {
    if (!output) return;

    if (!this.text) {
      this.text = extractOutputText(output);
    }

    for (const call of extractFunctionCalls(output)) {
      this.upsertFunctionCall(call);
    }
  }

  private processLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("event:")) return;
    if (trimmed === "data: [DONE]") {
      if (!this.completed) {
        this.completed = true;
        this.handlers.onCompleted?.(this.toTurn());
      }
      return;
    }

    if (!trimmed.startsWith("data: ")) return;

    try {
      const event = JSON.parse(trimmed.slice(6)) as ResponsesStreamEvent;
      this.handleEvent(event);
    } catch (error) {
      console.warn("Failed to parse Responses SSE data:", error, trimmed);
    }
  }

  private handleEvent(event: ResponsesStreamEvent) {
    const type = event.type;

    if (type === "response.output_text.delta" || type === "response.text.delta") {
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (delta) {
        this.text += delta;
        this.handlers.onTextDelta?.(delta);
      }
      return;
    }

    if (type === "response.output_item.added" || type === "response.output_item.done") {
      const item = event.item as ResponsesOutputItem | undefined;
      const outputIndex = typeof event.output_index === "number" ? event.output_index : -1;
      if (!item || typeof item !== "object") return;

      const itemRecord = item as Record<string, unknown>;
      if (itemRecord.type === "function_call") {
        const callId =
          (typeof itemRecord.call_id === "string" && itemRecord.call_id) ||
          (typeof itemRecord.callId === "string" && itemRecord.callId) ||
          (typeof itemRecord.id === "string" && itemRecord.id) ||
          undefined;
        const name = typeof itemRecord.name === "string" ? itemRecord.name : undefined;
        const args = typeof itemRecord.arguments === "string" ? itemRecord.arguments : "";

        if (outputIndex >= 0) {
          const pending = this.pendingByIndex.get(outputIndex) || { arguments: "" };
          this.pendingByIndex.set(outputIndex, {
            callId: callId || pending.callId,
            name: name || pending.name,
            arguments: args || pending.arguments,
            id: typeof itemRecord.id === "string" ? itemRecord.id : pending.id,
          });
        }

        if (callId && name && (type === "response.output_item.done" || args)) {
          this.upsertFunctionCall({
            callId,
            name,
            arguments: args || "{}",
            id: typeof itemRecord.id === "string" ? itemRecord.id : undefined,
          });
        }
      }

      if (itemRecord.type === "message" && type === "response.output_item.done") {
        const text = extractOutputText([item]);
        if (text && !this.text) {
          this.text = text;
          this.handlers.onTextDelta?.(text);
        }
      }
      return;
    }

    if (type === "response.function_call_arguments.delta") {
      const outputIndex = typeof event.output_index === "number" ? event.output_index : -1;
      const delta = typeof event.delta === "string" ? event.delta : "";
      if (outputIndex < 0 || !delta) return;
      const pending = this.pendingByIndex.get(outputIndex) || { arguments: "" };
      pending.arguments = `${pending.arguments || ""}${delta}`;
      this.pendingByIndex.set(outputIndex, pending);
      return;
    }

    if (type === "response.function_call_arguments.done") {
      const outputIndex = typeof event.output_index === "number" ? event.output_index : -1;
      const pending = outputIndex >= 0 ? this.pendingByIndex.get(outputIndex) : undefined;
      const callId = pending?.callId;
      const name = (typeof event.name === "string" && event.name) || pending?.name;
      const args =
        (typeof event.arguments === "string" && event.arguments) || pending?.arguments || "{}";

      if (callId && name) {
        this.upsertFunctionCall({
          callId,
          name,
          arguments: args,
          id: pending?.id,
        });
      }
      return;
    }

    if (
      type === "response.created" ||
      type === "response.in_progress" ||
      type === "response.completed" ||
      type === "response.failed"
    ) {
      const response = event.response as ResponsesObject | undefined;
      if (response?.id) this.responseId = response.id;
      if (response?.status) this.status = response.status;
      if (response?.id) {
        this.raw = response;
        this.absorbOutputItems(response.output);
      }

      if (type === "response.completed" || type === "response.failed") {
        this.completed = true;
        if (type === "response.failed") {
          const message = response?.error?.message || "Responses request failed";
          this.handlers.onError?.(message);
        }
        this.handlers.onCompleted?.(this.toTurn());
      }
      return;
    }

    if (type === "error") {
      const message =
        (typeof event.message === "string" && event.message) ||
        event.error?.message ||
        "Responses stream error";
      this.handlers.onError?.(message);
    }
  }
}

export async function processResponsesStreamingResponse(
  response: Response,
  handlers: ResponsesStreamHandlers = {},
): Promise<ParsedResponsesTurn> {
  const parser = new ResponsesSSEParser(handlers);
  return parser.processStream(response);
}

export async function createAndParseResponses(
  params: CreateResponsesParams,
  handlers: ResponsesStreamHandlers = {},
): Promise<ParsedResponsesTurn> {
  const response = await createResponsesRequest({
    ...params,
    stream: params.stream ?? true,
  });

  if (!response.ok) {
    const errorText = await response.text();
    const message = `Responses API error: ${response.status}|||${errorText}`;
    handlers.onError?.(message);
    throw new Error(message);
  }

  if (params.stream === false) {
    const payload = (await response.json()) as ResponsesObject;
    const turn = parseCompletedResponsesObject(payload);
    if (turn.text) handlers.onTextDelta?.(turn.text);
    for (const call of turn.functionCalls) {
      handlers.onFunctionCall?.(call);
    }
    handlers.onCompleted?.(turn);
    return turn;
  }

  return processResponsesStreamingResponse(response, handlers);
}

export function getErrorStatusCode(errorMessage: string): number | null {
  const match = /Responses API error:\s*(\d+)/.exec(errorMessage);
  if (!match) return null;
  return Number(match[1]);
}

export function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}