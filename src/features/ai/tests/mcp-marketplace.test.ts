import { describe, expect, it } from "vite-plus/test";
import {
  FEATURED_MCP_SERVERS,
  createRemoteMcpServerFromMarketplace,
  isMarketplaceMcpInstalled,
} from "@/features/ai/lib/mcp-marketplace";
import { isMcpOAuthCallbackUrl } from "@/features/ai/services/mcp-oauth-service";
import { normalizeRemoteMcpServers } from "@/features/ai/services/agent-http/mcp-remote-tools";

describe("mcp marketplace helpers", () => {
  it("includes curated featured servers with remotes", () => {
    expect(FEATURED_MCP_SERVERS.length).toBeGreaterThan(0);
    for (const server of FEATURED_MCP_SERVERS) {
      expect(server.remotes.length).toBeGreaterThan(0);
      expect(server.remotes[0]?.url.startsWith("http")).toBe(true);
    }
  });

  it("creates installable remote MCP configs from marketplace entries", () => {
    const featured = FEATURED_MCP_SERVERS[0];
    const created = createRemoteMcpServerFromMarketplace(featured);
    expect(created).not.toBeNull();
    expect(created?.url).toBe(featured.remotes[0]?.url);
    expect(created?.sourceId).toBe(featured.id);
    expect(created?.source).toBe("marketplace");
    expect(created?.enabled).toBe(true);
  });

  it("detects already installed marketplace servers by source id or url", () => {
    const featured = FEATURED_MCP_SERVERS[0];
    const created = createRemoteMcpServerFromMarketplace(featured);
    expect(created).not.toBeNull();
    expect(isMarketplaceMcpInstalled([created!], featured)).toBe(true);
    expect(
      isMarketplaceMcpInstalled(
        [
          {
            id: "other",
            label: "other",
            url: featured.remotes[0]!.url,
            enabled: true,
          },
        ],
        featured,
      ),
    ).toBe(true);
  });

  it("normalizes marketplace oauth metadata on installed servers", () => {
    const normalized = normalizeRemoteMcpServers([
      {
        id: " mcp_1 ",
        label: " bindings ",
        url: "https://bindings.mcp.cloudflare.com/mcp",
        enabled: true,
        source: "marketplace",
        sourceId: "featured.cloudflare-bindings",
        authType: "oauth",
        oauth: {
          resource: " https://bindings.mcp.cloudflare.com/mcp ",
          scopes: [" mcp:tools ", ""],
        },
      },
    ]);

    expect(normalized[0]).toMatchObject({
      id: "mcp_1",
      label: "bindings",
      source: "marketplace",
      authType: "oauth",
      oauth: {
        resource: "https://bindings.mcp.cloudflare.com/mcp",
        scopes: ["mcp:tools"],
      },
    });
  });
});

describe("mcp oauth helpers", () => {
  it("detects athas deep-link oauth callback urls", () => {
    expect(isMcpOAuthCallbackUrl("athas://mcp/oauth/callback?code=1&state=2")).toBe(true);
    expect(isMcpOAuthCallbackUrl("athas-dev://mcp/oauth/callback?code=1&state=2")).toBe(true);
    expect(isMcpOAuthCallbackUrl("athas://settings?tab=ai")).toBe(false);
  });
});
