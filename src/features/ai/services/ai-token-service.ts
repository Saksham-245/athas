import { invoke } from "@tauri-apps/api/core";

/**
 * Token management utilities for AI providers
 * Handles secure storage and retrieval of API tokens using Tauri's secure storage
 */

export type ProviderCredentialType = "api_key" | "oauth";

export type ProviderAuthMeta = {
  credentialType: ProviderCredentialType;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string | null;
  tokenType: string | null;
  clientId: string | null;
  issuer: string | null;
};

function authMetaProviderId(providerId: string): string {
  return `${providerId}__auth_meta`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function parseProviderAuthMeta(raw: string | null): ProviderAuthMeta | null {
  if (!raw) return null;

  try {
    const payload = asRecord(JSON.parse(raw));
    if (!payload) return null;

    const credentialType = payload.credentialType;
    if (credentialType !== "api_key" && credentialType !== "oauth") {
      return null;
    }

    return {
      credentialType,
      refreshToken: typeof payload.refreshToken === "string" ? payload.refreshToken : null,
      expiresAt: typeof payload.expiresAt === "number" ? payload.expiresAt : null,
      scope: typeof payload.scope === "string" ? payload.scope : null,
      tokenType: typeof payload.tokenType === "string" ? payload.tokenType : null,
      clientId: typeof payload.clientId === "string" ? payload.clientId : null,
      issuer: typeof payload.issuer === "string" ? payload.issuer : null,
    };
  } catch (error) {
    console.error("Error parsing provider auth metadata:", error);
    return null;
  }
}

// Get API token for a specific provider
export const getProviderApiToken = async (providerId: string): Promise<string | null> => {
  try {
    const token = (await invoke("get_ai_provider_token", {
      providerId,
    })) as string | null;
    return token;
  } catch (error) {
    console.error(`Error getting ${providerId} API token:`, error);
    return null;
  }
};

// Store API token for a specific provider
export const storeProviderApiToken = async (providerId: string, token: string): Promise<void> => {
  try {
    await invoke("store_ai_provider_token", { providerId, token });
  } catch (error) {
    console.error(`Error storing ${providerId} API token:`, error);
    throw error;
  }
};

// Remove API token for a specific provider
export const removeProviderApiToken = async (providerId: string): Promise<void> => {
  try {
    await invoke("remove_ai_provider_token", { providerId });
  } catch (error) {
    console.error(`Error removing ${providerId} API token:`, error);
    throw error;
  }
};

export const getProviderAuthMeta = async (
  providerId: string,
): Promise<ProviderAuthMeta | null> => {
  try {
    const raw = (await invoke("get_ai_provider_token", {
      providerId: authMetaProviderId(providerId),
    })) as string | null;
    return parseProviderAuthMeta(raw);
  } catch (error) {
    console.error(`Error getting ${providerId} auth metadata:`, error);
    return null;
  }
};

export const storeProviderAuthMeta = async (
  providerId: string,
  meta: ProviderAuthMeta,
): Promise<void> => {
  try {
    await invoke("store_ai_provider_token", {
      providerId: authMetaProviderId(providerId),
      token: JSON.stringify(meta),
    });
  } catch (error) {
    console.error(`Error storing ${providerId} auth metadata:`, error);
    throw error;
  }
};

export const removeProviderAuthMeta = async (providerId: string): Promise<void> => {
  try {
    await invoke("remove_ai_provider_token", {
      providerId: authMetaProviderId(providerId),
    });
  } catch (error) {
    console.error(`Error removing ${providerId} auth metadata:`, error);
    throw error;
  }
};

// Validate API key for a specific provider
export const validateProviderApiKey = async (
  providerId: string,
  apiKey: string,
): Promise<boolean> => {
  try {
    // Import provider dynamically to avoid circular dependency
    const { getProvider } = await import("@/features/ai/services/providers/ai-provider-registry");
    const provider = getProvider(providerId);

    if (!provider) {
      console.error(`Provider not found: ${providerId}`);
      return false;
    }

    return await provider.validateApiKey(apiKey);
  } catch (error) {
    console.error(`${providerId} API key validation error:`, error);
    return false;
  }
};
