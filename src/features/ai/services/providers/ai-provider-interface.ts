import type { AIMessage } from "@/features/ai/types/messages.types";

export interface ProviderCapabilities {
  supportsResponses?: boolean;
  supportsTools?: boolean;
  supportsRemoteMcp?: boolean;
}

export interface ProviderConfig {
  id: string;
  name: string;
  apiUrl: string;
  requiresApiKey: boolean;
  maxTokens: number;
  capabilities?: ProviderCapabilities;
}

export interface ProviderHeaders {
  [key: string]: string;
}

export interface StreamRequest {
  modelId: string;
  messages: AIMessage[];
  maxTokens: number;
  temperature: number;
  apiKey?: string;
  responseFormat?: "text" | "json_object";
}

export interface ProviderModel {
  id: string;
  name: string;
  maxTokens?: number;
}

export abstract class AIProvider {
  constructor(protected config: ProviderConfig) {}

  abstract buildHeaders(apiKey?: string): ProviderHeaders;
  abstract buildPayload(request: StreamRequest): any;
  abstract validateApiKey(apiKey: string): Promise<boolean>;

  // Optional: Allows providers to customize the URL (e.g., add API key as query param)
  buildUrl?(request: StreamRequest): string;

  // Optional: Allows providers to fetch available models dynamically
  async getModels?(apiKey?: string): Promise<ProviderModel[]> {
    void apiKey;
    return [];
  }

  get id(): string {
    return this.config.id;
  }

  get name(): string {
    return this.config.name;
  }

  get apiUrl(): string {
    return this.config.apiUrl;
  }

  get requiresApiKey(): boolean {
    return this.config.requiresApiKey;
  }

  get capabilities(): ProviderCapabilities {
    return this.config.capabilities ?? {};
  }

  get supportsResponses(): boolean {
    return this.capabilities.supportsResponses === true;
  }

  get supportsTools(): boolean {
    return this.capabilities.supportsTools === true;
  }

  get supportsRemoteMcp(): boolean {
    return this.capabilities.supportsRemoteMcp === true;
  }
}
