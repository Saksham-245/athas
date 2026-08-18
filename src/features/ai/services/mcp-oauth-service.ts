import { openUrl } from "@tauri-apps/plugin-opener";
import type { RemoteMcpOAuthConfig, RemoteMcpServerConfig } from "@/features/ai/types/mcp.types";
import {
  getProviderApiToken,
  getProviderAuthMeta,
  removeProviderApiToken,
  removeProviderAuthMeta,
  storeProviderApiToken,
  storeProviderAuthMeta,
} from "@/features/ai/services/ai-token-service";
import { providerFetch } from "@/features/ai/services/providers/provider-fetch";

const MCP_OAUTH_CALLBACK_PATH = "/mcp/oauth/callback";
const DEFAULT_SCOPES = ["openid", "profile", "email", "offline_access", "mcp:tools"];

export class McpOAuthError extends Error {
  code:
    | "network"
    | "invalid_response"
    | "discovery"
    | "pkce"
    | "expired"
    | "denied"
    | "invalid_state"
    | "failed";

  constructor(code: McpOAuthError["code"], message: string) {
    super(message);
    this.name = "McpOAuthError";
    this.code = code;
  }
}

type OAuthServerMetadata = {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint?: string;
  codeChallengeMethodsSupported: string[];
  scopesSupported: string[];
};

type PendingOAuthSession = {
  serverId: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  tokenEndpoint: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  resource?: string;
  createdAt: number;
};

type DynamicClientRegistration = {
  clientId: string;
  clientSecret?: string;
};

const pendingSessions = new Map<string, PendingOAuthSession>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function mcpTokenProviderId(serverId: string): string {
  return `mcp__${serverId}`;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomString(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function sha256Base64Url(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toBase64Url(new Uint8Array(digest));
}

function encodeForm(data: Record<string, string>): string {
  return Object.entries(data)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function getDeepLinkCallbackUri(): string {
  const protocol =
    typeof window !== "undefined" && window.location.protocol.startsWith("athas")
      ? window.location.protocol.replace(":", "")
      : "athas";
  return `${protocol}://${MCP_OAUTH_CALLBACK_PATH.replace(/^\//, "")}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function candidateProtectedResourceUrls(resourceUrl: string): string[] {
  try {
    const url = new URL(resourceUrl);
    const path = url.pathname.replace(/\/+$/, "") || "";
    const candidates = [
      `${url.origin}/.well-known/oauth-protected-resource${path}`,
      `${url.origin}/.well-known/oauth-protected-resource`,
    ];
    return Array.from(new Set(candidates));
  } catch {
    return [];
  }
}

function candidateAuthServerMetadataUrls(issuer: string): string[] {
  try {
    const url = new URL(issuer);
    const path = url.pathname.replace(/\/+$/, "");
    if (path) {
      return [
        `${url.origin}/.well-known/oauth-authorization-server${path}`,
        `${url.origin}/.well-known/openid-configuration${path}`,
        `${url.origin}${path}/.well-known/openid-configuration`,
      ];
    }
    return [
      `${url.origin}/.well-known/oauth-authorization-server`,
      `${url.origin}/.well-known/openid-configuration`,
    ];
  } catch {
    return [];
  }
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const response = await providerFetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return asRecord(await readJson(response));
  } catch {
    return null;
  }
}

export async function discoverMcpOAuthMetadata(
  server: RemoteMcpServerConfig,
): Promise<OAuthServerMetadata> {
  const configured = server.oauth || {};
  const resource = configured.resource || server.url;

  let authorizationServer = configured.authorizationServer || null;
  if (!authorizationServer) {
    for (const candidate of candidateProtectedResourceUrls(resource)) {
      const metadata = await fetchJson(candidate);
      const servers = metadata?.authorization_servers;
      if (Array.isArray(servers) && typeof servers[0] === "string") {
        authorizationServer = servers[0];
        break;
      }
    }
  }

  if (!authorizationServer && configured.authorizationEndpoint && configured.tokenEndpoint) {
    return {
      issuer: configured.authorizationServer || new URL(configured.authorizationEndpoint).origin,
      authorizationEndpoint: configured.authorizationEndpoint,
      tokenEndpoint: configured.tokenEndpoint,
      registrationEndpoint: configured.registrationEndpoint,
      codeChallengeMethodsSupported: ["S256"],
      scopesSupported: configured.scopes || DEFAULT_SCOPES,
    };
  }

  if (!authorizationServer) {
    // Fall back to probing the MCP URL origin.
    authorizationServer = new URL(server.url).origin;
  }

  for (const candidate of candidateAuthServerMetadataUrls(authorizationServer)) {
    const metadata = await fetchJson(candidate);
    if (!metadata) continue;

    const issuer = asString(metadata.issuer);
    const authorizationEndpoint = asString(metadata.authorization_endpoint);
    const tokenEndpoint = asString(metadata.token_endpoint);
    if (!issuer || !authorizationEndpoint || !tokenEndpoint) continue;
    if (issuer.replace(/\/+$/, "") !== authorizationServer.replace(/\/+$/, "")) continue;

    const methods = Array.isArray(metadata.code_challenge_methods_supported)
      ? metadata.code_challenge_methods_supported.filter(
          (method): method is string => typeof method === "string",
        )
      : [];
    if (!methods.includes("S256")) {
      throw new McpOAuthError("pkce", "Authorization server does not advertise S256 PKCE support.");
    }

    const scopesSupported = Array.isArray(metadata.scopes_supported)
      ? metadata.scopes_supported.filter((scope): scope is string => typeof scope === "string")
      : configured.scopes || DEFAULT_SCOPES;

    return {
      issuer,
      authorizationEndpoint,
      tokenEndpoint,
      registrationEndpoint:
        asString(metadata.registration_endpoint) || configured.registrationEndpoint,
      codeChallengeMethodsSupported: methods,
      scopesSupported,
    };
  }

  throw new McpOAuthError(
    "discovery",
    "Could not discover OAuth metadata for this MCP server. Add auth endpoints manually or use a bearer token.",
  );
}

async function registerOAuthClient(
  registrationEndpoint: string,
  redirectUri: string,
  clientName = "Athas",
): Promise<DynamicClientRegistration> {
  const response = await providerFetch(registrationEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    }),
  });

  const payload = asRecord(await readJson(response));
  if (!response.ok) {
    throw new McpOAuthError(
      "failed",
      asString(payload?.error_description) ||
        asString(payload?.error) ||
        `Dynamic client registration failed (${response.status}).`,
    );
  }

  const clientId = asString(payload?.client_id);
  if (!clientId) {
    throw new McpOAuthError("invalid_response", "OAuth client registration returned no client_id.");
  }

  return {
    clientId,
    clientSecret: asString(payload?.client_secret) || undefined,
  };
}

export async function beginMcpOAuthLogin(server: RemoteMcpServerConfig): Promise<{
  authorizationUrl: string;
  state: string;
}> {
  const metadata = await discoverMcpOAuthMetadata(server);
  const redirectUri = getDeepLinkCallbackUri();
  const configured = server.oauth || {};

  let clientId = configured.clientId;
  let clientSecret = configured.clientSecret;
  if (!clientId) {
    if (!metadata.registrationEndpoint) {
      throw new McpOAuthError(
        "failed",
        "This MCP server requires OAuth but did not provide a client id or registration endpoint.",
      );
    }
    const registered = await registerOAuthClient(metadata.registrationEndpoint, redirectUri);
    clientId = registered.clientId;
    clientSecret = registered.clientSecret;
  }

  const state = randomString(24);
  const codeVerifier = randomString(48);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const scopes =
    configured.scopes && configured.scopes.length > 0
      ? configured.scopes
      : metadata.scopesSupported.length > 0
        ? metadata.scopesSupported.slice(0, 6)
        : DEFAULT_SCOPES;
  const resource = configured.resource || server.url;

  pendingSessions.set(state, {
    serverId: server.id,
    state,
    codeVerifier,
    redirectUri,
    tokenEndpoint: metadata.tokenEndpoint,
    clientId,
    clientSecret,
    scopes,
    resource,
    createdAt: Date.now(),
  });

  const authUrl = new URL(metadata.authorizationEndpoint);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("scope", scopes.join(" "));
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("resource", resource);

  return {
    authorizationUrl: authUrl.toString(),
    state,
  };
}

export async function openMcpOAuthLogin(server: RemoteMcpServerConfig): Promise<string> {
  const session = await beginMcpOAuthLogin(server);
  await openUrl(session.authorizationUrl);
  return session.state;
}

async function exchangeAuthorizationCode(
  session: PendingOAuthSession,
  code: string,
): Promise<{ accessToken: string; refreshToken: string | null; expiresAt: number | null; scope: string | null; tokenType: string | null }> {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: session.redirectUri,
    client_id: session.clientId,
    code_verifier: session.codeVerifier,
  };
  if (session.clientSecret) body.client_secret = session.clientSecret;
  if (session.resource) body.resource = session.resource;

  const response = await providerFetch(session.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: encodeForm(body),
  });

  const payload = asRecord(await readJson(response));
  if (!response.ok) {
    throw new McpOAuthError(
      "failed",
      asString(payload?.error_description) ||
        asString(payload?.error) ||
        `OAuth token exchange failed (${response.status}).`,
    );
  }

  const accessToken = asString(payload?.access_token);
  if (!accessToken) {
    throw new McpOAuthError("invalid_response", "OAuth token response missing access_token.");
  }

  const expiresIn = typeof payload?.expires_in === "number" ? payload.expires_in : null;
  return {
    accessToken,
    refreshToken: asString(payload?.refresh_token),
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    scope: asString(payload?.scope),
    tokenType: asString(payload?.token_type) || "Bearer",
  };
}

export async function completeMcpOAuthCallback(url: string): Promise<{ serverId: string }> {
  const parsed = new URL(url);
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");
  const error = parsed.searchParams.get("error");

  if (error) {
    throw new McpOAuthError(
      error === "access_denied" ? "denied" : "failed",
      parsed.searchParams.get("error_description") || `OAuth failed: ${error}`,
    );
  }
  if (!code || !state) {
    throw new McpOAuthError("invalid_response", "OAuth callback missing code/state.");
  }

  const session = pendingSessions.get(state);
  if (!session) {
    throw new McpOAuthError("invalid_state", "OAuth state is unknown or expired. Start login again.");
  }
  pendingSessions.delete(state);

  const tokenSet = await exchangeAuthorizationCode(session, code);
  const providerId = mcpTokenProviderId(session.serverId);
  await storeProviderApiToken(providerId, tokenSet.accessToken);
  await storeProviderAuthMeta(providerId, {
    credentialType: "oauth",
    refreshToken: tokenSet.refreshToken,
    expiresAt: tokenSet.expiresAt,
    scope: tokenSet.scope,
    tokenType: tokenTypeOrBearer(tokenSet.tokenType),
    clientId: session.clientId,
    issuer: session.tokenEndpoint,
  });

  return { serverId: session.serverId };
}

function tokenTypeOrBearer(value: string | null): string {
  return value || "Bearer";
}

export async function refreshMcpAccessToken(
  server: RemoteMcpServerConfig,
): Promise<string | null> {
  const providerId = mcpTokenProviderId(server.id);
  const meta = await getProviderAuthMeta(providerId);
  if (!meta?.refreshToken) return null;

  const metadata = await discoverMcpOAuthMetadata(server);
  const body: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: meta.refreshToken,
    client_id: meta.clientId || server.oauth?.clientId || "",
  };
  if (server.oauth?.clientSecret) body.client_secret = server.oauth.clientSecret;
  if (server.oauth?.resource || server.url) {
    body.resource = server.oauth?.resource || server.url;
  }

  const response = await providerFetch(metadata.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: encodeForm(body),
  });
  const payload = asRecord(await readJson(response));
  if (!response.ok) return null;

  const accessToken = asString(payload?.access_token);
  if (!accessToken) return null;
  const expiresIn = typeof payload?.expires_in === "number" ? payload.expires_in : null;

  await storeProviderApiToken(providerId, accessToken);
  await storeProviderAuthMeta(providerId, {
    ...meta,
    refreshToken: asString(payload?.refresh_token) || meta.refreshToken,
    expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : meta.expiresAt,
    scope: asString(payload?.scope) || meta.scope,
    tokenType: asString(payload?.token_type) || meta.tokenType || "Bearer",
  });

  return accessToken;
}

export async function getMcpBearerAuthorization(
  server: RemoteMcpServerConfig,
  options: { forceRefresh?: boolean } = {},
): Promise<string | null> {
  if (server.authType === "oauth" || server.oauth) {
    const providerId = mcpTokenProviderId(server.id);
    const meta = await getProviderAuthMeta(providerId);
    const existing = await getProviderApiToken(providerId);
    const expired =
      typeof meta?.expiresAt === "number" ? meta.expiresAt <= Date.now() + 30_000 : false;

    if (options.forceRefresh || (expired && meta?.refreshToken)) {
      const refreshed = await refreshMcpAccessToken(server);
      if (refreshed) return `Bearer ${refreshed}`;
    }

    if (existing) {
      const tokenType = meta?.tokenType || "Bearer";
      return `${tokenType} ${existing}`.replace(/^Bearer Bearer /i, "Bearer ");
    }
  }

  if (server.authorization?.trim()) {
    const value = server.authorization.trim();
    return /^bearer\s+/i.test(value) ? value : `Bearer ${value}`;
  }

  return null;
}

export async function hasMcpOAuthSession(serverId: string): Promise<boolean> {
  const token = await getProviderApiToken(mcpTokenProviderId(serverId));
  return Boolean(token);
}

export async function signOutMcpOAuth(serverId: string): Promise<void> {
  const providerId = mcpTokenProviderId(serverId);
  await removeProviderApiToken(providerId);
  await removeProviderAuthMeta(providerId);
}

export function isMcpOAuthCallbackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, "");
    const hostPath = `${parsed.host}${parsed.pathname}`;
    return (
      path === MCP_OAUTH_CALLBACK_PATH ||
      (parsed.host === "mcp" && parsed.pathname.startsWith("/oauth/callback")) ||
      hostPath.includes("mcp/oauth/callback")
    );
  } catch {
    return false;
  }
}

export function getPendingMcpOAuthServerIds(): string[] {
  return Array.from(pendingSessions.values()).map((session) => session.serverId);
}
