import { MagnifyingGlassIcon as Search, TrashIcon as Trash2 } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createRemoteMcpServerFromMarketplace,
  isMarketplaceMcpInstalled,
  loadMcpMarketplace,
} from "@/features/ai/lib/mcp-marketplace";
import {
  hasMcpOAuthSession,
  openMcpOAuthLogin,
  signOutMcpOAuth,
} from "@/features/ai/services/mcp-oauth-service";
import { createEmptyRemoteMcpServer } from "@/features/ai/services/agent-http/mcp-remote-tools";
import type { MarketplaceMcpServer, RemoteMcpServerConfig } from "@/features/ai/types/mcp.types";
import { useToast } from "@/features/layout/contexts/toast-context";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { LoadingIndicator } from "@/ui/loading";
import Switch from "@/ui/switch";
import Section, { SettingRow } from "../settings-section";

export function McpMarketplaceSection() {
  const { settings, updateSetting } = useSettingsStore();
  const { showToast } = useToast();
  const installedServers = settings.aiRemoteMcpServers || [];

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [marketplaceServers, setMarketplaceServers] = useState<MarketplaceMcpServer[]>([]);
  const [isLoadingMarketplace, setIsLoadingMarketplace] = useState(false);
  const [oauthConnectedIds, setOauthConnectedIds] = useState<Set<string>>(new Set());
  const [connectingServerId, setConnectingServerId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const refreshMarketplace = useCallback(async (search = "") => {
    setIsLoadingMarketplace(true);
    try {
      const servers = await loadMcpMarketplace({ query: search, includeFeatured: true });
      setMarketplaceServers(servers);
    } finally {
      setIsLoadingMarketplace(false);
    }
  }, []);

  useEffect(() => {
    void refreshMarketplace(debouncedQuery);
  }, [debouncedQuery, refreshMarketplace]);

  const refreshOAuthSessions = useCallback(async () => {
    const connected = new Set<string>();
    await Promise.all(
      installedServers.map(async (server) => {
        if (server.authType === "oauth" || server.oauth) {
          if (await hasMcpOAuthSession(server.id)) {
            connected.add(server.id);
          }
        }
      }),
    );
    setOauthConnectedIds(connected);
  }, [installedServers]);

  useEffect(() => {
    void refreshOAuthSessions();
  }, [refreshOAuthSessions]);

  const featuredServers = useMemo(
    () => marketplaceServers.filter((server) => server.source === "featured"),
    [marketplaceServers],
  );
  const registryServers = useMemo(
    () => marketplaceServers.filter((server) => server.source === "registry"),
    [marketplaceServers],
  );

  const persistServers = async (next: RemoteMcpServerConfig[]) => {
    await updateSetting("aiRemoteMcpServers", next);
  };

  const handleInstallMarketplaceServer = async (server: MarketplaceMcpServer) => {
    if (isMarketplaceMcpInstalled(installedServers, server)) {
      showToast({ message: `${server.title} is already installed`, type: "info" });
      return;
    }

    const created = createRemoteMcpServerFromMarketplace(server);
    if (!created) {
      showToast({ message: "This MCP entry has no installable remote URL", type: "error" });
      return;
    }

    await persistServers([created, ...installedServers]);
    showToast({ message: `Installed ${server.title}`, type: "success" });

    if (created.authType === "oauth") {
      showToast({
        message: "OAuth required. Click Connect on the installed server.",
        type: "info",
      });
    }
  };

  const updateInstalledServer = async (
    index: number,
    patch: Partial<RemoteMcpServerConfig>,
  ) => {
    const next = installedServers.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item,
    );
    await persistServers(next);
  };

  const handleConnectOAuth = async (server: RemoteMcpServerConfig) => {
    setConnectingServerId(server.id);
    try {
      await openMcpOAuthLogin(server);
      showToast({
        message: "Complete MCP OAuth in your browser, then return to Athas",
        type: "info",
      });
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : "Failed to start MCP OAuth",
        type: "error",
      });
    } finally {
      setConnectingServerId(null);
    }
  };

  const handleDisconnectOAuth = async (serverId: string) => {
    try {
      await signOutMcpOAuth(serverId);
      await refreshOAuthSessions();
      showToast({ message: "Disconnected MCP OAuth session", type: "success" });
    } catch {
      showToast({ message: "Failed to disconnect MCP OAuth", type: "error" });
    }
  };

  return (
    <Section title="Remote MCP">
      <SettingRow
        label="Installed servers"
        description="Used by Athas Agent Chat/Agent modes with Grok Responses. Marketplace installs and manual servers appear here."
      >
        <Button
          type="button"
          variant="default"
          onClick={() => {
            void persistServers([createEmptyRemoteMcpServer(), ...installedServers]);
          }}
        >
          Add server
        </Button>
      </SettingRow>

      {installedServers.map((server, index) => {
        const needsOAuth = server.authType === "oauth" || Boolean(server.oauth);
        const isConnected = oauthConnectedIds.has(server.id);

        return (
          <div
            key={server.id}
            className="space-y-2 rounded-md border border-border/70 bg-secondary-bg/30 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate ui-text-xs font-medium text-text">
                  {server.label.trim() || `MCP server ${index + 1}`}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {server.source ? <Badge size="sm">{server.source}</Badge> : null}
                  {server.authType ? <Badge size="sm">{server.authType}</Badge> : null}
                  {needsOAuth ? (
                    <Badge size="sm">{isConnected ? "oauth connected" : "oauth required"}</Badge>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={server.enabled}
                  onChange={(checked) => void updateInstalledServer(index, { enabled: checked })}
                  aria-label={`Enable ${server.label || "MCP server"}`}
                />
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    void (async () => {
                      if (needsOAuth) {
                        await signOutMcpOAuth(server.id).catch(() => undefined);
                      }
                      await persistServers(
                        installedServers.filter((_, itemIndex) => itemIndex !== index),
                      );
                    })();
                  }}
                  className="text-error hover:bg-error/10 hover:text-error"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <Input
                value={server.label}
                onChange={(event) => void updateInstalledServer(index, { label: event.currentTarget.value })}
                placeholder="server_label"
                size="xs"
              />
              <Input
                value={server.url}
                onChange={(event) => void updateInstalledServer(index, { url: event.currentTarget.value })}
                placeholder="https://mcp.example.com/mcp"
                size="xs"
              />
            </div>

            <Input
              value={server.description || ""}
              onChange={(event) =>
                void updateInstalledServer(index, { description: event.currentTarget.value })
              }
              placeholder="Optional description"
              size="xs"
            />

            {!needsOAuth ? (
              <Input
                value={server.authorization || ""}
                onChange={(event) =>
                  void updateInstalledServer(index, { authorization: event.currentTarget.value })
                }
                placeholder="Optional authorization header value"
                size="xs"
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="accent"
                  disabled={connectingServerId === server.id}
                  onClick={() => void handleConnectOAuth(server)}
                >
                  {connectingServerId === server.id
                    ? "Opening browser..."
                    : isConnected
                      ? "Reconnect OAuth"
                      : "Connect with OAuth"}
                </Button>
                {isConnected ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void handleDisconnectOAuth(server.id)}
                    className="text-error hover:bg-error/10 hover:text-error"
                  >
                    Disconnect
                  </Button>
                ) : null}
              </div>
            )}

            <Input
              value={(server.allowedTools || []).join(", ")}
              onChange={(event) =>
                void updateInstalledServer(index, {
                  allowedTools: event.currentTarget.value
                    .split(",")
                    .map((tool) => tool.trim())
                    .filter(Boolean),
                })
              }
              placeholder="Optional allowed tools (comma-separated)"
              size="xs"
            />
          </div>
        );
      })}

      <SettingRow
        label="MCP marketplace"
        description="Browse featured open-source MCP servers and search the official MCP registry."
      >
        <div className="flex items-center gap-2">
          {isLoadingMarketplace ? <LoadingIndicator label="Loading" showLabel compact /> : null}
          <Button type="button" variant="ghost" onClick={() => void refreshMarketplace(debouncedQuery)}>
            Refresh
          </Button>
        </div>
      </SettingRow>

      <div className="relative">
        <Search
          size={14}
          className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-text-lighter"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search MCP servers"
          size="xs"
          className="pl-8"
        />
      </div>

      {featuredServers.length > 0 ? (
        <div className="space-y-2">
          <div className="ui-text-xs font-medium text-text-lighter">Featured</div>
          {featuredServers.map((server) => {
            const installed = isMarketplaceMcpInstalled(installedServers, server);
            return (
              <div
                key={server.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-primary-bg/40 p-3"
              >
                <div className="min-w-0">
                  <div className="truncate ui-text-xs font-medium text-text">{server.title}</div>
                  <div className="mt-1 ui-text-xs text-text-lighter">{server.description}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge size="sm">featured</Badge>
                    <Badge size="sm">{server.authType}</Badge>
                    {server.publisher ? <Badge size="sm">{server.publisher}</Badge> : null}
                  </div>
                </div>
                <Button
                  type="button"
                  variant={installed ? "ghost" : "default"}
                  disabled={installed}
                  onClick={() => void handleInstallMarketplaceServer(server)}
                >
                  {installed ? "Installed" : "Install"}
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="space-y-2">
        <div className="ui-text-xs font-medium text-text-lighter">
          Registry{debouncedQuery ? ` · “${debouncedQuery}”` : ""}
        </div>
        {registryServers.length === 0 && !isLoadingMarketplace ? (
          <div className="rounded-md border border-border/70 bg-secondary-bg/20 px-3 py-4 ui-text-xs text-text-lighter">
            No registry servers matched. Try another search.
          </div>
        ) : (
          registryServers.slice(0, 30).map((server) => {
            const installed = isMarketplaceMcpInstalled(installedServers, server);
            return (
              <div
                key={server.id}
                className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-secondary-bg/20 p-3"
              >
                <div className="min-w-0">
                  <div className="truncate ui-text-xs font-medium text-text">{server.title}</div>
                  <div className="mt-1 ui-text-xs text-text-lighter">{server.description}</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge size="sm">registry</Badge>
                    <Badge size="sm">{server.authType}</Badge>
                    {server.version ? <Badge size="sm">v{server.version}</Badge> : null}
                  </div>
                </div>
                <Button
                  type="button"
                  variant={installed ? "ghost" : "default"}
                  disabled={installed}
                  onClick={() => void handleInstallMarketplaceServer(server)}
                >
                  {installed ? "Installed" : "Install"}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </Section>
  );
}
