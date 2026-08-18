import type { ImageContent } from "@/features/ai/types/ai-chat.types";
import type { PastedImage } from "@/features/ai/types/ai-chat-store.types";
import type { AIMessage, AIMessageContentPart } from "@/features/ai/types/messages.types";

const PROVIDERS_WITH_OPENAI_STYLE_VISION = new Set([
  "grok",
  "openai",
  "openrouter",
  "v0",
  "custom",
  "deepseek",
  "mistral",
  "ollama",
]);

export function providerSupportsVisionAttachments(providerId: string): boolean {
  return PROVIDERS_WITH_OPENAI_STYLE_VISION.has(providerId);
}

export function parseDataUrl(dataUrl: string): { mediaType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  if (!match) return null;
  return {
    mediaType: match[1],
    data: match[2],
  };
}

export function pastedImagesToImageContent(images: PastedImage[]): ImageContent[] {
  return images
    .map((image) => {
      const parsed = parseDataUrl(image.dataUrl);
      if (!parsed) return null;
      return {
        data: parsed.data,
        mediaType: parsed.mediaType,
      } satisfies ImageContent;
    })
    .filter((image): image is ImageContent => image !== null);
}

export function buildUserMessageContent(
  text: string,
  images: ImageContent[] = [],
): string | AIMessageContentPart[] {
  const trimmed = text.trim();
  if (images.length === 0) {
    return trimmed;
  }

  const parts: AIMessageContentPart[] = [];
  for (const image of images) {
    parts.push({
      type: "image_url",
      image_url: {
        url: `data:${image.mediaType};base64,${image.data}`,
        detail: "high",
      },
    });
  }

  if (trimmed) {
    parts.push({
      type: "text",
      text: trimmed,
    });
  }

  return parts;
}

export function getMessageTextContent(content: AIMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .filter((part): part is Extract<AIMessageContentPart, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function imageContentFromFile(file: File): Promise<PastedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        reject(new Error("Failed to read image"));
        return;
      }
      resolve({
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        dataUrl,
        name: file.name || `image-${Date.now()}.png`,
        size: file.size,
      });
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}
