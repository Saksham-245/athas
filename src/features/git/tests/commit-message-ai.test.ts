import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("@/features/ai/services/xai-auth-service", () => ({
  getGrokBearerToken: vi.fn(),
}));

describe("resolveCommitMessageAiTarget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers grok-4.5 when an xAI/Grok bearer token is available", async () => {
    const { getGrokBearerToken } = await import("@/features/ai/services/xai-auth-service");
    const { resolveCommitMessageAiTarget } = await import("../utils/commit-message-ai");

    vi.mocked(getGrokBearerToken).mockResolvedValue("xai-token");

    await expect(
      resolveCommitMessageAiTarget({
        autocompleteModelId: "mistralai/devstral-small",
        hasAthasAuth: false,
      }),
    ).resolves.toEqual({
      kind: "grok",
      provider: "grok",
      model: "grok-4.5",
    });
  });

  it("falls back to hosted autocomplete when Grok is unavailable and Athas auth exists", async () => {
    const { getGrokBearerToken } = await import("@/features/ai/services/xai-auth-service");
    const { resolveCommitMessageAiTarget } = await import("../utils/commit-message-ai");

    vi.mocked(getGrokBearerToken).mockResolvedValue(null);

    await expect(
      resolveCommitMessageAiTarget({
        autocompleteModelId: "mistralai/devstral-small",
        hasAthasAuth: true,
      }),
    ).resolves.toEqual({
      kind: "hosted",
      model: "mistralai/devstral-small",
    });
  });

  it("errors when neither Grok nor Athas auth is available", async () => {
    const { getGrokBearerToken } = await import("@/features/ai/services/xai-auth-service");
    const { resolveCommitMessageAiTarget } = await import("../utils/commit-message-ai");

    vi.mocked(getGrokBearerToken).mockResolvedValue(null);

    await expect(
      resolveCommitMessageAiTarget({
        autocompleteModelId: "mistralai/devstral-small",
        hasAthasAuth: false,
      }),
    ).rejects.toThrow(/Sign in with xAI \(Grok\) or Athas/);
  });
});
