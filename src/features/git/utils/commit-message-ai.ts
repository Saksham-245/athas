import { getGrokBearerToken } from "@/features/ai/services/xai-auth-service";

export const GROK_COMMIT_MESSAGE_MODEL_ID = "grok-4.5";
export const GROK_COMMIT_MESSAGE_PROVIDER_ID = "grok";

export type CommitMessageAiTarget =
  | {
      kind: "grok";
      provider: typeof GROK_COMMIT_MESSAGE_PROVIDER_ID;
      model: typeof GROK_COMMIT_MESSAGE_MODEL_ID;
    }
  | {
      kind: "hosted";
      provider?: undefined;
      model: string;
    };

export async function resolveCommitMessageAiTarget(params: {
  autocompleteModelId: string;
  hasAthasAuth: boolean;
}): Promise<CommitMessageAiTarget> {
  const grokToken = await getGrokBearerToken();
  if (grokToken) {
    return {
      kind: "grok",
      provider: GROK_COMMIT_MESSAGE_PROVIDER_ID,
      model: GROK_COMMIT_MESSAGE_MODEL_ID,
    };
  }

  if (!params.hasAthasAuth) {
    throw new Error(
      "Sign in with xAI (Grok) or Athas to generate commit messages.",
    );
  }

  return {
    kind: "hosted",
    model: params.autocompleteModelId.trim() || "mistralai/devstral-small",
  };
}
