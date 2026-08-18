import type { RemoteMcpServerConfig } from "@/features/ai/types/mcp.types";
import { getMcpBearerAuthorization } from "@/features/ai/services/mcp-oauth-service";
import type { ResponsesMcpToolDefinition } from "./tool-types";

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function normalizeRemoteMcpServers(
  servers: RemoteMcpServerConfig[] | null | undefined,
): RemoteMcpServerConfig[] {
  if (!Array.isArray(servers)) return [];

  const seenLabels = new Set<string>();
  const normalized: RemoteMcpServerConfig[] = [];

  for (const server of servers) {
    if (!server || typeof server !== "object") continue;

    const id = typeof server.id === "string" ? server.id.trim() : "";
    const label = typeof server.label === "string" ? server.label.trim() : "";
    const url = typeof server.url === "string" ? server.url.trim() : "";
    if (!id || !label || !url || !isHttpUrl(url)) continue;

    const labelKey = label.toLowerCase();
    if (seenLabels.has(labelKey)) continue;
    seenLabels.add(labelKey);

    const headers =
      server.headers && typeof server.headers === "object" && !Array.isArray(server.headers)
        ? Object.fromEntries(
            Object.entries(server.headers)
              .filter(([key, value]) => key.trim() && typeof value === "string")
              .map(([key, value]) => [key.trim(), String(value)]),
          )
        : undefined;

    const allowedTools = Array.isArray(server.allowedTools)
      ? server.allowedTools
          .filter((tool): tool is string => typeof tool === "string")
          .map((tool) => tool.trim())
          .filter(Boolean)
      : undefined;

    const oauth =
      server.oauth && typeof server.oauth === "object"
        ? {
            authorizationServer:
              typeof server.oauth.authorizationServer === "string"
                ? server.oauth.authorizationServer.trim() || undefined
                : undefined,
            clientId:
              typeof server.oauth.clientId === "string"
                ? server.oauth.clientId.trim() || undefined
                : undefined,
            clientSecret:
              typeof server.oauth.clientSecret === "string"
                ? server.oauth.clientSecret.trim() || undefined
                : undefined,
            scopes: Array.isArray(server.oauth.scopes)
              ? server.oauth.scopes
                  .filter((scope): scope is string => typeof scope === "string")
                  .map((scope) => scope.trim())
                  .filter(Boolean)
              : undefined,
            tokenEndpoint:
              typeof server.oauth.tokenEndpoint === "string"
                ? server.oauth.tokenEndpoint.trim() || undefined
                : undefined,
            authorizationEndpoint:
              typeof server.oauth.authorizationEndpoint === "string"
                ? server.oauth.authorizationEndpoint.trim() || undefined
                : undefined,
            registrationEndpoint:
              typeof server.oauth.registrationEndpoint === "string"
                ? server.oauth.registrationEndpoint.trim() || undefined
                : undefined,
            resource:
              typeof server.oauth.resource === "string"
                ? server.oauth.resource.trim() || undefined
                : undefined,
          }
        : undefined;

    normalized.push({
      id,
      label,
      url,
      enabled: server.enabled !== false,
      description:
        typeof server.description === "string" && server.description.trim()
          ? server.description.trim()
          : undefined,
      authorization:
        typeof server.authorization === "string" && server.authorization.trim()
          ? server.authorization.trim()
          : undefined,
      headers: headers && Object.keys(headers).length > 0 ? headers : undefined,
      allowedTools: allowedTools && allowedTools.length > 0 ? allowedTools : undefined,
      source:
        server.source === "manual" ||
        server.source === "marketplace" ||
        server.source === "registry"
          ? server.source
          : undefined,
      sourceId:
        typeof server.sourceId === "string" && server.sourceId.trim()
          ? server.sourceId.trim()
          : undefined,
      authType:
        server.authType === "none" ||
        server.authType === "bearer" ||
        server.authType === "oauth" ||
        server.authType === "headers"
          ? server.authType
          : oauth
            ? "oauth"
            : undefined,
      oauth,
      homepageUrl:
        typeof server.homepageUrl === "string" && server.homepageUrl.trim()
          ? server.homepageUrl.trim()
          : undefined,
      publisher:
        typeof server.publisher === "string" && server.publisher.trim()
          ? server.publisher.trim()
          : undefined,
      version:
        typeof server.version === "string" && server.version.trim()
          ? server.version.trim()
          : undefined,
    });
  }

  return normalized;
}

export async function toResponsesMcpTools(
  servers: RemoteMcpServerConfig[] | null | undefined,
): Promise<ResponsesMcpToolDefinition[]> {
  const enabledServers = normalizeRemoteMcpServers(servers).filter((server) => server.enabled);

  return Promise.all(
    enabledServers.map(async (server) => {
      const tool: ResponsesMcpToolDefinition = {
        type: "mcp",
        server_url: server.url,
        server_label: server.label,
      };

      if (server.description) tool.server_description = server.description;
      if (server.allowedTools) tool.allowed_tools = server.allowedTools;

      const authorization = await getMcpBearerAuthorization(server);
      if (authorization) tool.authorization = authorization;
      else if (server.authorization) tool.authorization = server.authorization;

      if (server.headers) tool.headers = server.headers;
      return tool;
    }),
  );
}

export function createEmptyRemoteMcpServer(): RemoteMcpServerConfig {
  return {
    id: `mcp_${Date.now().toString(36)}`,
    label: "",
    url: "",
    enabled: true,
    source: "manual",
    authType: "none",
  };
}