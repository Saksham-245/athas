export type McpAuthType = "none" | "bearer" | "oauth" | "headers";

export type RemoteMcpOAuthConfig = {
  authorizationServer?: string;
  clientId?: string;
  clientSecret?: string;
  scopes?: string[];
  tokenEndpoint?: string;
  authorizationEndpoint?: string;
  registrationEndpoint?: string;
  resource?: string;
};

export type RemoteMcpServerConfig = {
  id: string;
  label: string;
  url: string;
  enabled: boolean;
  description?: string;
  authorization?: string;
  headers?: Record<string, string>;
  allowedTools?: string[];
  source?: "manual" | "marketplace" | "registry";
  sourceId?: string;
  authType?: McpAuthType;
  oauth?: RemoteMcpOAuthConfig;
  homepageUrl?: string;
  publisher?: string;
  version?: string;
};

export type MarketplaceMcpRemote = {
  type: "streamable-http" | "sse" | string;
  url: string;
  headers?: Array<{
    name: string;
    value?: string;
    description?: string;
    isRequired?: boolean;
    isSecret?: boolean;
  }>;
};

export type MarketplaceMcpServer = {
  id: string;
  name: string;
  title: string;
  description: string;
  version?: string;
  publisher?: string;
  homepageUrl?: string;
  source: "featured" | "registry";
  remotes: MarketplaceMcpRemote[];
  authType: McpAuthType;
  oauth?: RemoteMcpOAuthConfig;
  tags?: string[];
  updatedAt?: string;
};
