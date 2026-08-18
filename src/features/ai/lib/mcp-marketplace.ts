import type {
  MarketplaceMcpRemote,
  MarketplaceMcpServer,
  McpAuthType,
  RemoteMcpOAuthConfig,
  RemoteMcpServerConfig,
} from "@/features/ai/types/mcp.types";
import { providerFetch } from "@/features/ai/services/providers/provider-fetch";

const MCP_REGISTRY_URL =
  import.meta.env.VITE_MCP_REGISTRY_URL || "https://registry.modelcontextprotocol.io/v0.1/servers";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function inferAuthType(remotes: MarketplaceMcpRemote[], oauth?: RemoteMcpOAuthConfig): McpAuthType {
  if (oauth?.authorizationServer || oauth?.authorizationEndpoint) return "oauth";
  const hasAuthHeader = remotes.some((remote) =>
    (remote.headers || []).some((header) => header.name.toLowerCase() === "authorization"),
  );
  if (hasAuthHeader) return "bearer";
  const hasOtherHeaders = remotes.some((remote) => (remote.headers || []).length > 0);
  if (hasOtherHeaders) return "headers";
  return "none";
}

function normalizeRemote(raw: unknown): MarketplaceMcpRemote | null {
  const record = asRecord(raw);
  if (!record) return null;
  const url = asString(record.url);
  if (!url) return null;
  const type = asString(record.type) || "streamable-http";
  const headers = Array.isArray(record.headers)
    ? record.headers
        .map((header) => {
          const item = asRecord(header);
          if (!item) return null;
          const name = asString(item.name);
          if (!name) return null;
          return {
            name,
            value: asString(item.value),
            description: asString(item.description),
            isRequired: item.isRequired === true,
            isSecret: item.isSecret === true,
          };
        })
        .filter((header): header is NonNullable<typeof header> => Boolean(header))
    : undefined;

  return {
    type,
    url,
    headers,
  };
}

export const FEATURED_MCP_SERVERS: MarketplaceMcpServer[] = [
  {
    id: "featured.deepwiki",
    name: "deepwiki",
    title: "DeepWiki",
    description: "Ask questions about public GitHub repositories via DeepWiki MCP.",
    version: "1.0.0",
    publisher: "Cognition",
    homepageUrl: "https://mcp.deepwiki.com",
    source: "featured",
    remotes: [{ type: "streamable-http", url: "https://mcp.deepwiki.com/mcp" }],
    authType: "none",
    tags: ["docs", "github", "featured"],
  },
  {
    id: "featured.cloudflare-docs",
    name: "cloudflare-docs",
    title: "Cloudflare Docs",
    description: "Search and retrieve Cloudflare documentation through a remote MCP server.",
    version: "1.0.0",
    publisher: "Cloudflare",
    homepageUrl: "https://developers.cloudflare.com",
    source: "featured",
    remotes: [{ type: "streamable-http", url: "https://docs.mcp.cloudflare.com/mcp" }],
    authType: "none",
    tags: ["docs", "cloudflare", "featured"],
  },
  {
    id: "featured.cloudflare-bindings",
    name: "cloudflare-bindings",
    title: "Cloudflare Bindings",
    description: "Manage Cloudflare Workers bindings via remote MCP (OAuth required).",
    version: "1.0.0",
    publisher: "Cloudflare",
    homepageUrl: "https://developers.cloudflare.com",
    source: "featured",
    remotes: [{ type: "streamable-http", url: "https://bindings.mcp.cloudflare.com/mcp" }],
    authType: "oauth",
    oauth: {
      resource: "https://bindings.mcp.cloudflare.com/mcp",
      scopes: ["mcp:tools"],
    },
    tags: ["cloudflare", "oauth", "featured"],
  },
  {
    id: "featured.sequential-thinking",
    name: "sequentialthinking",
    title: "Sequential Thinking",
    description: "Structured multi-step reasoning helper exposed as a remote MCP tool.",
    version: "1.0.0",
    publisher: "Community",
    source: "featured",
    remotes: [
      {
        type: "streamable-http",
        url: "https://server.smithery.ai/@smithery-ai/server-sequential-thinking/mcp",
      },
    ],
    authType: "bearer",
    tags: ["reasoning", "featured"],
  },
];

function normalizeRegistryServer(raw: unknown): MarketplaceMcpServer | null {
  const wrapper = asRecord(raw);
  const server = asRecord(wrapper?.server) || wrapper;
  if (!server) return null;

  const remotes = (Array.isArray(server.remotes) ? server.remotes : [])
    .map(normalizeRemote)
    .filter((remote): remote is MarketplaceMcpRemote => Boolean(remote));
  if (remotes.length === 0) return null;

  const name = asString(server.name) || asString(server.title);
  if (!name) return null;
  const title = asString(server.title) || name;
  const description =
    asString(server.description) || "Remote MCP server from the official MCP registry.";
  const id = asString(server.name) || `registry.${slugify(title)}`;

  const oauthRecord = asRecord(server.oauth) || asRecord(server.auth);
  const oauth: RemoteMcpOAuthConfig | undefined = oauthRecord
    ? {
        authorizationServer: asString(oauthRecord.authorizationServer) || asString(oauthRecord.issuer),
        clientId: asString(oauthRecord.clientId),
        clientSecret: asString(oauthRecord.clientSecret),
        scopes: Array.isArray(oauthRecord.scopes)
          ? oauthRecord.scopes.filter((scope): scope is string => typeof scope === "string")
          : undefined,
        tokenEndpoint: asString(oauthRecord.tokenEndpoint),
        authorizationEndpoint: asString(oauthRecord.authorizationEndpoint),
        registrationEndpoint: asString(oauthRecord.registrationEndpoint),
        resource: asString(oauthRecord.resource) || remotes[0]?.url,
      }
    : remotes[0]
      ? { resource: remotes[0].url }
      : undefined;

  const authType = inferAuthType(remotes, oauth);

  return {
    id,
    name,
    title,
    description,
    version: asString(server.version),
    publisher: asString(server.publisher) || asString(server.author),
    homepageUrl: asString(server.homepage) || asString(server.websiteUrl) || asString(server.repository),
    source: "registry",
    remotes,
    authType,
    oauth: authType === "oauth" ? oauth : undefined,
    tags: Array.isArray(server.tags)
      ? server.tags.filter((tag): tag is string => typeof tag === "string")
      : undefined,
    updatedAt: asString((wrapper?._meta as any)?.["io.modelcontextprotocol.registry/official"]?.updatedAt),
  };
}

export async function loadFeaturedMcpServers(): Promise<MarketplaceMcpServer[]> {
  return FEATURED_MCP_SERVERS.map((server) => ({ ...server }));
}

export async function searchMcpRegistry(query = "", limit = 40): Promise<MarketplaceMcpServer[]> {
  try {
    const url = new URL(MCP_REGISTRY_URL);
    if (query.trim()) url.searchParams.set("search", query.trim());
    url.searchParams.set("limit", String(Math.max(1, Math.min(limit, 100))));

    const response = await providerFetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return [];

    const payload = (await response.json()) as unknown;
    const servers = Array.isArray(payload)
      ? payload
      : Array.isArray((payload as { servers?: unknown }).servers)
        ? ((payload as { servers: unknown[] }).servers)
        : [];

    const seen = new Set<string>();
    return servers
      .map(normalizeRegistryServer)
      .filter((server): server is MarketplaceMcpServer => {
        if (!server || seen.has(server.id)) return false;
        seen.add(server.id);
        return true;
      });
  } catch (error) {
    console.warn("Failed to load MCP registry:", error);
    return [];
  }
}

export async function loadMcpMarketplace(options?: {
  query?: string;
  includeFeatured?: boolean;
}): Promise<MarketplaceMcpServer[]> {
  const includeFeatured = options?.includeFeatured !== false;
  const query = options?.query?.trim() || "";

  const [featured, registry] = await Promise.all([
    includeFeatured ? loadFeaturedMcpServers() : Promise.resolve([]),
    searchMcpRegistry(query),
  ]);

  const featuredFiltered = query
    ? featured.filter((server) => {
        const haystack = `${server.title} ${server.description} ${server.name} ${(server.tags || []).join(" ")}`.toLowerCase();
        return haystack.includes(query.toLowerCase());
      })
    : featured;

  const seen = new Set(featuredFiltered.map((server) => server.id));
  const merged = [...featuredFiltered];
  for (const server of registry) {
    if (seen.has(server.id)) continue;
    // Prefer matching by remote URL against featured.
    const overlapsFeatured = featuredFiltered.some((featuredServer) =>
      featuredServer.remotes.some((remote) => server.remotes.some((item) => item.url === remote.url)),
    );
    if (overlapsFeatured) continue;
    seen.add(server.id);
    merged.push(server);
  }
  return merged;
}

export function getPreferredMcpRemote(server: MarketplaceMcpServer): MarketplaceMcpRemote | null {
  return (
    server.remotes.find((remote) => remote.type === "streamable-http") ||
    server.remotes.find((remote) => remote.type === "sse") ||
    server.remotes[0] ||
    null
  );
}

export function createRemoteMcpServerFromMarketplace(
  server: MarketplaceMcpServer,
): RemoteMcpServerConfig | null {
  const remote = getPreferredMcpRemote(server);
  if (!remote) return null;

  const headers = Object.fromEntries(
    (remote.headers || [])
      .filter((header) => header.value && !header.value.includes("{"))
      .map((header) => [header.name, header.value!]),
  );

  return {
    id: `mcp_${slugify(server.id)}_${Date.now().toString(36)}`,
    label: slugify(server.title || server.name).replace(/-/g, "_") || server.name,
    url: remote.url,
    enabled: true,
    description: server.description,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    source: server.source === "featured" ? "marketplace" : "registry",
    sourceId: server.id,
    authType: server.authType,
    oauth: server.oauth,
    homepageUrl: server.homepageUrl,
    publisher: server.publisher,
    version: server.version,
  };
}

export function isMarketplaceMcpInstalled(
  installed: RemoteMcpServerConfig[],
  marketplace: MarketplaceMcpServer,
): boolean {
  const remote = getPreferredMcpRemote(marketplace);
  return installed.some(
    (server) =>
      server.sourceId === marketplace.id ||
      (remote && server.url === remote.url) ||
      server.label === marketplace.name,
  );
}
