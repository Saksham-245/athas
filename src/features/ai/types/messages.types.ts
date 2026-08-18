export type AIMessageContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
        detail?: "auto" | "low" | "high";
      };
    };

export type AIMessageContent = string | AIMessageContentPart[];

interface AIUserMessage {
  role: "user";
  content: AIMessageContent;
}

interface AIAssistantMessage {
  role: "assistant";
  content: AIMessageContent;
}

interface AISystemMessage {
  role: "system";
  content: AIMessageContent;
}

export type AIMessage = AIUserMessage | AIAssistantMessage | AISystemMessage;
