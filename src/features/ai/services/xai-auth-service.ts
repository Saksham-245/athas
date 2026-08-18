import { openUrl } from "@tauri-apps/plugin-opener";
import { providerFetch } from "@/features/ai/services/providers/provider-fetch";
import {
  getProviderApiToken,
  getProviderAuthMeta,
  removeProviderApiToken,
  removeProviderAuthMeta,
  storeProviderApiToken,
  storeProviderAuthMeta,
  type ProviderAuthMeta,
} from "@/features/ai/services/ai-token-service";

export const XAI_GROK_PROVIDER_ID = "grok";

const XAI_OIDC_ISSUER = "https://auth.x.ai";
const XAI_DEVICE_CODE_URL = `${XAI_OIDC_ISSUER}/oauth2/device/code`;
const XAI_TOKEN_URL = `${XAI_OIDC_ISSUER}/oauth2/token`;
const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "api:access",
  "grok-cli:access",
].join(" ");

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const REFRESH_SKEW_MS = 60_000;

export type XaiDeviceLoginSession = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string | null;
  expiresAt: number;
  intervalMs: number;
};

export type XaiTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string | null;
  tokenType: string;
};

export class XaiAuthError extends Error {
  code:
    | "device_denied"
    | "expired"
    | "slow_down"
    | "invalid_client"
    | "network"
    | "invalid_response"
    | "cancelled"
    | "failed";

  constructor(code: XaiAuthError["code"], message: string) {
    super(message);
    this.name = "XaiAuthError";
    this.code = code;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function encodeForm(data: Record<string, string>): string {
  return new URLSearchParams(data).toString();
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function beginXaiDeviceLogin(): Promise<XaiDeviceLoginSession> {
  let response: Response;
  try {
    response = await providerFetch(XAI_DEVICE_CODE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: encodeForm({
        client_id: XAI_CLIENT_ID,
        scope: XAI_SCOPES,
      }),
    });
  } catch (error) {
    throw new XaiAuthError(
      "network",
      error instanceof Error ? error.message : "Failed to start xAI device login.",
    );
  }

  const payload = asRecord(await readJson(response));
  if (!response.ok) {
    const description =
      asNonEmptyString(payload?.error_description) ||
      asNonEmptyString(payload?.error) ||
      `Failed to start xAI device login (${response.status}).`;
    throw new XaiAuthError(
      response.status === 401 || response.status === 403 ? "invalid_client" : "failed",
      description,
    );
  }

  const deviceCode = asNonEmptyString(payload?.device_code);
  const userCode = asNonEmptyString(payload?.user_code);
  const verificationUri = asNonEmptyString(payload?.verification_uri);
  const verificationUriComplete = asNonEmptyString(payload?.verification_uri_complete);
  const expiresIn = typeof payload?.expires_in === "number" ? payload.expires_in : null;
  const interval = typeof payload?.interval === "number" ? payload.interval : null;

  if (!deviceCode || !userCode || !verificationUri || !expiresIn) {
    throw new XaiAuthError("invalid_response", "Invalid xAI device login response.");
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresAt: Date.now() + expiresIn * 1000,
    intervalMs: Math.max(1_000, (interval ?? 5) * 1000),
  };
}

export async function openXaiVerificationUrl(session: XaiDeviceLoginSession): Promise<void> {
  const url = session.verificationUriComplete || session.verificationUri;
  await openUrl(url);
}

async function exchangeDeviceCode(deviceCode: string): Promise<XaiTokenSet | "pending" | "slow_down"> {
  let response: Response;
  try {
    response = await providerFetch(XAI_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: encodeForm({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: XAI_CLIENT_ID,
      }),
    });
  } catch (error) {
    throw new XaiAuthError(
      "network",
      error instanceof Error ? error.message : "Failed to poll xAI device login.",
    );
  }

  const payload = asRecord(await readJson(response));
  if (response.ok) {
    return parseTokenSet(payload);
  }

  const errorCode = asNonEmptyString(payload?.error);
  if (errorCode === "authorization_pending") {
    return "pending";
  }
  if (errorCode === "slow_down") {
    return "slow_down";
  }
  if (errorCode === "expired_token") {
    throw new XaiAuthError("expired", "xAI device login expired. Start again.");
  }
  if (errorCode === "access_denied") {
    throw new XaiAuthError("device_denied", "xAI device login was denied.");
  }

  throw new XaiAuthError(
    "failed",
    asNonEmptyString(payload?.error_description) ||
      asNonEmptyString(payload?.error) ||
      `xAI device login failed (${response.status}).`,
  );
}

function parseTokenSet(payload: Record<string, unknown> | null): XaiTokenSet {
  const accessToken = asNonEmptyString(payload?.access_token);
  if (!accessToken) {
    throw new XaiAuthError("invalid_response", "xAI token response was missing access_token.");
  }

  const expiresIn = typeof payload?.expires_in === "number" ? payload.expires_in : null;

  return {
    accessToken,
    refreshToken: asNonEmptyString(payload?.refresh_token),
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    scope: asNonEmptyString(payload?.scope),
    tokenType: asNonEmptyString(payload?.token_type) || "Bearer",
  };
}

export async function waitForXaiDeviceToken(
  session: XaiDeviceLoginSession,
  options: {
    signal?: AbortSignal;
    onIntervalMsChange?: (intervalMs: number) => void;
  } = {},
): Promise<XaiTokenSet> {
  let intervalMs = session.intervalMs || DEFAULT_POLL_INTERVAL_MS;

  while (Date.now() < session.expiresAt) {
    if (options.signal?.aborted) {
      throw new XaiAuthError("cancelled", "xAI device login was cancelled.");
    }

    const result = await exchangeDeviceCode(session.deviceCode);
    if (result === "pending") {
      await sleep(intervalMs, options.signal);
      continue;
    }
    if (result === "slow_down") {
      intervalMs += 5_000;
      options.onIntervalMsChange?.(intervalMs);
      await sleep(intervalMs, options.signal);
      continue;
    }

    return result;
  }

  throw new XaiAuthError("expired", "xAI device login expired. Start again.");
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new XaiAuthError("cancelled", "xAI device login was cancelled.");
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeout);
      reject(new XaiAuthError("cancelled", "xAI device login was cancelled."));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function refreshXaiAccessToken(refreshToken: string): Promise<XaiTokenSet> {
  let response: Response;
  try {
    response = await providerFetch(XAI_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: encodeForm({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: XAI_CLIENT_ID,
      }),
    });
  } catch (error) {
    throw new XaiAuthError(
      "network",
      error instanceof Error ? error.message : "Failed to refresh xAI access token.",
    );
  }

  const payload = asRecord(await readJson(response));
  if (!response.ok) {
    throw new XaiAuthError(
      "failed",
      asNonEmptyString(payload?.error_description) ||
        asNonEmptyString(payload?.error) ||
        `Failed to refresh xAI access token (${response.status}).`,
    );
  }

  const tokenSet = parseTokenSet(payload);
  return {
    ...tokenSet,
    refreshToken: tokenSet.refreshToken || refreshToken,
  };
}

export async function validateXaiAccessToken(accessToken: string): Promise<boolean> {
  try {
    const response = await providerFetch("https://api.x.ai/v1/language-models", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });
    return response.ok;
  } catch (error) {
    console.error("xAI access token validation error:", error);
    return false;
  }
}

export async function storeXaiTokenSet(tokenSet: XaiTokenSet): Promise<void> {
  const meta: ProviderAuthMeta = {
    credentialType: "oauth",
    refreshToken: tokenSet.refreshToken,
    expiresAt: tokenSet.expiresAt,
    scope: tokenSet.scope,
    tokenType: tokenSet.tokenType,
    clientId: XAI_CLIENT_ID,
    issuer: XAI_OIDC_ISSUER,
  };

  await storeProviderApiToken(XAI_GROK_PROVIDER_ID, tokenSet.accessToken);
  await storeProviderAuthMeta(XAI_GROK_PROVIDER_ID, meta);
}

export async function storeGrokApiKeyCredential(apiKey: string): Promise<void> {
  const meta: ProviderAuthMeta = {
    credentialType: "api_key",
    refreshToken: null,
    expiresAt: null,
    scope: null,
    tokenType: "Bearer",
    clientId: null,
    issuer: null,
  };

  await storeProviderApiToken(XAI_GROK_PROVIDER_ID, apiKey);
  await storeProviderAuthMeta(XAI_GROK_PROVIDER_ID, meta);
}

export async function getGrokAuthMeta(): Promise<ProviderAuthMeta | null> {
  return getProviderAuthMeta(XAI_GROK_PROVIDER_ID);
}

export async function hasGrokOAuthSession(): Promise<boolean> {
  const meta = await getGrokAuthMeta();
  return meta?.credentialType === "oauth";
}

export async function getGrokBearerToken(options: { forceRefresh?: boolean } = {}): Promise<string | null> {
  const token = await getProviderApiToken(XAI_GROK_PROVIDER_ID);
  if (!token) {
    return null;
  }

  const meta = await getGrokAuthMeta();
  if (!meta || meta.credentialType !== "oauth") {
    return token;
  }

  const needsRefresh =
    options.forceRefresh ||
    (typeof meta.expiresAt === "number" && meta.expiresAt - Date.now() <= REFRESH_SKEW_MS);

  if (!needsRefresh) {
    return token;
  }

  if (!meta.refreshToken) {
    return token;
  }

  try {
    const refreshed = await refreshXaiAccessToken(meta.refreshToken);
    await storeXaiTokenSet(refreshed);
    return refreshed.accessToken;
  } catch (error) {
    console.error("Failed to refresh xAI access token:", error);
    if (options.forceRefresh) {
      return null;
    }
    return token;
  }
}

export async function signOutXai(): Promise<void> {
  const meta = await getGrokAuthMeta();
  if (meta?.credentialType === "oauth") {
    await removeProviderApiToken(XAI_GROK_PROVIDER_ID);
  }
  await removeProviderAuthMeta(XAI_GROK_PROVIDER_ID);
}

export async function completeXaiDeviceLogin(
  session: XaiDeviceLoginSession,
  options: {
    signal?: AbortSignal;
    openBrowser?: boolean;
    onIntervalMsChange?: (intervalMs: number) => void;
  } = {},
): Promise<XaiTokenSet> {
  if (options.openBrowser !== false) {
    await openXaiVerificationUrl(session);
  }

  const tokenSet = await waitForXaiDeviceToken(session, {
    signal: options.signal,
    onIntervalMsChange: options.onIntervalMsChange,
  });

  const isValid = await validateXaiAccessToken(tokenSet.accessToken);
  if (!isValid) {
    throw new XaiAuthError(
      "failed",
      "Signed in with xAI, but the access token was rejected by the Grok API.",
    );
  }

  await storeXaiTokenSet(tokenSet);
  return tokenSet;
}
