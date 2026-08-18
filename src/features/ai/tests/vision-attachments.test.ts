import { describe, expect, it } from "vite-plus/test";
import {
  buildUserMessageContent,
  parseDataUrl,
  pastedImagesToImageContent,
  providerSupportsVisionAttachments,
} from "@/features/ai/lib/vision-attachments";

describe("vision attachments", () => {
  it("marks OpenAI-compatible providers as vision capable", () => {
    expect(providerSupportsVisionAttachments("grok")).toBe(true);
    expect(providerSupportsVisionAttachments("openai")).toBe(true);
    expect(providerSupportsVisionAttachments("anthropic")).toBe(false);
  });

  it("parses data URLs into media type and base64 payload", () => {
    expect(parseDataUrl("data:image/png;base64,abcd1234")).toEqual({
      mediaType: "image/png",
      data: "abcd1234",
    });
  });

  it("builds multimodal user content with images first", () => {
    const content = buildUserMessageContent("What is this?", [
      { mediaType: "image/png", data: "abcd1234" },
    ]);

    expect(content).toEqual([
      {
        type: "image_url",
        image_url: {
          url: "data:image/png;base64,abcd1234",
          detail: "high",
        },
      },
      {
        type: "text",
        text: "What is this?",
      },
    ]);
  });

  it("converts pasted images into API image content", () => {
    expect(
      pastedImagesToImageContent([
        {
          id: "1",
          dataUrl: "data:image/jpeg;base64,xyz",
          name: "shot.jpg",
          size: 12,
        },
      ]),
    ).toEqual([{ mediaType: "image/jpeg", data: "xyz" }]);
  });
});
