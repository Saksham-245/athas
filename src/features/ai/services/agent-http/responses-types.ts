import type { AIMessage, AIMessageContent } from "@/features/ai/types/messages.types";
import type {
  AgentHttpFunctionCallOutput,
  ResponsesToolDefinition,
} from "./tool-types";

export type ResponsesInputContentPart =
  | {
      type: "input_text" | "output_text" | "text";
      text: string;
    }
  | {
      type: "input_image" | "image_url";
      image_url: string | { url: string; detail?: "auto" | "low" | "high" };
      detail?: "auto" | "low" | "high";
    };

export type ResponsesMessageInput = {
  type?: "message";
  role: "system" | "user" | "assistant" | "developer";
  content: string | ResponsesInputContentPart[];
};

export type ResponsesInputItem =
  | ResponsesMessageInput
  | AgentHttpFunctionCallOutput
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
      id?: string;
    };

export type ResponsesCreateRequest = {
  model: string;
  input: string | ResponsesInputItem[];
  instructions?: string;
  tools?: ResponsesToolDefinition[];
  tool_choice?: "auto" | "none" | "required" | { type: "function"; name: string };
  previous_response_id?: string;
  max_output_tokens?: number;
  temperature?: number;
  stream?: boolean;
  store?: boolean;
  parallel_tool_calls?: boolean;
};

export type ResponsesOutputTextPart = {
  type: "output_text" | "text";
  text: string;
};

export type ResponsesMessageOutput = {
  type: "message";
  id?: string;
  role?: "assistant";
  status?: string;
  content?: Array<ResponsesOutputTextPart | { type: string; [key: string]: unknown }>;
};

export type ResponsesFunctionCallOutput = {
  type: "function_call";
  id?: string;
  call_id?: string;
  callId?: string;
  name: string;
  arguments: string;
  status?: string;
};

export type ResponsesOutputItem =
  | ResponsesMessageOutput
  | ResponsesFunctionCallOutput
  | {
      type: string;
      [key: string]: unknown;
    };

export type ResponsesObject = {
  id: string;
  object?: "response";
  status?: "completed" | "in_progress" | "incomplete" | "failed" | "cancelled";
  model?: string;
  output?: ResponsesOutputItem[];
  error?: { message?: string; code?: string } | null;
  previous_response_id?: string | null;
};

export type ResponsesStreamEvent = {
  type: string;
  delta?: string;
  output_index?: number;
  content_index?: number;
  item?: ResponsesOutputItem;
  item_id?: string;
  arguments?: string;
  name?: string;
  response?: ResponsesObject;
  message?: string;
  error?: { message?: string };
  [key: string]: unknown;
};

export type ParsedResponsesTurn = {
  responseId: string | null;
  status: ResponsesObject["status"] | null;
  text: string;
  functionCalls: Array<{
    callId: string;
    name: string;
    arguments: string;
    id?: string;
  }>;
  raw: ResponsesObject | null;
};

function mapContentPart(part: AIMessageContent): string | ResponsesInputContentPart[] {
  if (typeof part === "string") return part;

  return part.map((item) => {
    if (item.type === "text") {
      return {
        type: "input_text" as const,
        text: item.text,
      };
    }

    return {
      type: "input_image" as const,
      image_url:
        typeof item.image_url === "string"
          ? item.image_url
          : {
              url: item.image_url.url,
              detail: item.image_url.detail,
            },
      detail: typeof item.image_url === "string" ? undefined : item.image_url.detail,
    };
  });
}

export function athasMessagesToResponsesInput(messages: AIMessage[]): {
  instructions?: string;
  input: ResponsesInputItem[];
} {
  let instructions: string | undefined;
  const input: ResponsesInputItem[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n");
      instructions = instructions ? `${instructions}\n\n${text}` : text;
      continue;
    }

    input.push({
      role: message.role,
      content: mapContentPart(message.content),
    });
  }

  return { instructions, input };
}

export function extractFunctionCalls(output: ResponsesOutputItem[] | undefined) {
  if (!output) return [];

  return output.flatMap((item) => {
    if (item.type !== "function_call") return [];
    const call = item as ResponsesFunctionCallOutput;
    const callId = call.call_id || call.callId || call.id;
    if (!callId || !call.name) return [];
    return [
      {
        callId,
        name: call.name,
        arguments: call.arguments || "{}",
        id: call.id,
      },
    ];
  });
}

export function extractOutputText(output: ResponsesOutputItem[] | undefined): string {
  if (!output) return "";

  const chunks: string[] = [];
  for (const item of output) {
    if (item.type !== "message") continue;
    const message = item as ResponsesMessageOutput;
    for (const part of message.content || []) {
      if (
        (part.type === "output_text" || part.type === "text") &&
        typeof (part as ResponsesOutputTextPart).text === "string"
      ) {
        chunks.push((part as ResponsesOutputTextPart).text);
      }
    }
  }
  return chunks.join("");
}

export function parseCompletedResponsesObject(response: ResponsesObject): ParsedResponsesTurn {
  return {
    responseId: response.id || null,
    status: response.status || null,
    text: extractOutputText(response.output),
    functionCalls: extractFunctionCalls(response.output),
    raw: response,
  };
}