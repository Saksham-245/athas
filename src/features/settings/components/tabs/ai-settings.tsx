import { invoke } from "@tauri-apps/api/core";
import {
  WarningCircleIcon as AlertCircle,
  CheckCircleIcon as CheckCircle,
  CloudIcon as Cloud,
  ArrowSquareOutIcon as ExternalLink,
  GlobeHemisphereWestIcon as Globe,
  KeyIcon as Key,
  LaptopIcon as Laptop,
  ArrowClockwiseIcon as RefreshCw,
  ArrowCounterClockwiseIcon as RotateCcw,
  TrashIcon as Trash2,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ProviderApiKeyCommand } from "@/features/ai/components/provider-api-key-command";
import { ModelSelector } from "@/features/ai/components/selectors/model-selector";
import { ProviderSelector } from "@/features/ai/components/selectors/provider-selector";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { AgentConfig, SessionConfigOption } from "@/features/ai/types/acp.types";
import { getAvailableProviders } from "@/features/ai/types/providers.types";
import { useToast } from "@/features/layout/contexts/toast-context";
import { TypedConfirmAction } from "@/features/settings/components/typed-confirm-action";
import { LoadingIndicator } from "@/ui/loading";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/stores/settings.store";
import { useAuthStore } from "@/features/window/stores/auth.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import { SegmentedControl } from "@/ui/segmented-control";
import Section, { SETTINGS_CONTROL_WIDTHS, SettingRow } from "../settings-section";
import Select from "@/ui/select";
import Switch from "@/ui/switch";
import { fetchAutocompleteModels } from "@/features/editor/services/editor-autocomplete-service";
import {
  CUSTOM_AUTOCOMPLETE_PROVIDER_ID,
  CUSTOM_CHAT_PROVIDER_ID,
} from "@/features/ai/lib/custom-provider-config";
import { cn } from "@/utils/cn";
import {
  setCustomProviderBaseUrl,
  setOllamaApiKey,
  setOllamaBaseUrl,
} from "@/features/ai/services/providers/ai-provider-registry";
import {
  DEFAULT_OLLAMA_BASE_URL,
  OLLAMA_CLOUD_BASE_URL,
  checkOllamaConnection,
  isOllamaCloudUrl,
} from "@/features/ai/services/providers/ollama-provider";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
} from "@/features/ai/services/ai-token-service";
import {
  getXaiManagementApiKey,
  removeXaiManagementApiKey,
  storeXaiManagementApiKey,
} from "@/features/ai/services/xai-usage-service";
import { SkillsCommand } from "@/features/ai/components/skills/skills-command";
import { McpMarketplaceSection } from "@/features/settings/components/tabs/mcp-marketplace-section";
const DEFAULT_AUTOCOMPLETE_MODEL_ID = "mistralai/devstral-small";

function resolveAutocompleteDefaultModelId(models: Array<{ id: string; name: string }>): string {
  if (models.some((model) => model.id === DEFAULT_AUTOCOMPLETE_MODEL_ID)) {
    return DEFAULT_AUTOCOMPLETE_MODEL_ID;
  }
  return models[0]?.id || DEFAULT_AUTOCOMPLETE_MODEL_ID;
}

export const AISettings = () => {
  const { settings, updateSetting } = useSettingsStore();
  const subscription = useAuthStore((state) => state.subscription);
  const { showToast } = useToast();
  const enterprisePolicy = subscription?.enterprise?.policy;
  const managedPolicy = enterprisePolicy?.managedMode ? enterprisePolicy : null;
  const aiCompletionAllowedByPolicy = managedPolicy ? managedPolicy.aiCompletionEnabled : true;
  const byokAllowedByPolicy = managedPolicy ? managedPolicy.allowByok : true;

  const [sessionConfigOptions, setSessionConfigOptions] = useState<SessionConfigOption[]>([]);
  const [isClearingChats, setIsClearingChats] = useState(false);
  const [autocompleteModels, setAutocompleteModels] = useState<Array<{ id: string; name: string }>>(
    [],
  );
  const [isLoadingAutocompleteModels, setIsLoadingAutocompleteModels] = useState(false);
  const [autocompleteModelError, setAutocompleteModelError] = useState<string | null>(null);
  const [customAutocompleteModelInput, setCustomAutocompleteModelInput] = useState(
    settings.aiAutocompleteCustomModelId,
  );
  const [customAutocompleteBaseUrlInput, setCustomAutocompleteBaseUrlInput] = useState(
    settings.aiAutocompleteCustomBaseUrl,
  );
  const [customAutocompleteApiKeyInput, setCustomAutocompleteApiKeyInput] = useState("");
  const [hasCustomAutocompleteApiKey, setHasCustomAutocompleteApiKey] = useState(false);
  const [isSavingCustomAutocompleteApiKey, setIsSavingCustomAutocompleteApiKey] = useState(false);
  const [customChatBaseUrlInput, setCustomChatBaseUrlInput] = useState(settings.aiCustomBaseUrl);
  const [customChatApiKeyInput, setCustomChatApiKeyInput] = useState("");
  const [hasCustomChatApiKey, setHasCustomChatApiKey] = useState(false);
  const [isSavingCustomChatApiKey, setIsSavingCustomChatApiKey] = useState(false);
  const [isApiKeyManagerOpen, setIsApiKeyManagerOpen] = useState(false);

  // Ollama URL state
  const [ollamaUrl, setOllamaUrl] = useState(settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL);
  const [ollamaStatus, setOllamaStatus] = useState<"idle" | "checking" | "ok" | "error">("idle");
  const ollamaDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Ollama API key state (used for Ollama Cloud; optional for local)
  const [ollamaApiKeyInput, setOllamaApiKeyInput] = useState("");
  const [hasStoredOllamaKey, setHasStoredOllamaKey] = useState(false);
  const [isSavingOllamaKey, setIsSavingOllamaKey] = useState(false);

  // xAI management/billing usage credentials
  const [xaiTeamIdInput, setXaiTeamIdInput] = useState(settings.xaiTeamId || "");
  const [xaiManagementKeyInput, setXaiManagementKeyInput] = useState("");
  const [hasXaiManagementKey, setHasXaiManagementKey] = useState(false);
  const [isSavingXaiManagementKey, setIsSavingXaiManagementKey] = useState(false);
  const [isSkillsMarketplaceOpen, setIsSkillsMarketplaceOpen] = useState(false);

  const isOllamaCloud = isOllamaCloudUrl(ollamaUrl);
  const needsApiKey = isOllamaCloud;

  useEffect(() => {
    const detectAgents = async () => {
      try {
        await invoke<AgentConfig[]>("get_available_agents");
      } catch {
        // Failed to detect agents
      }
    };
    detectAgents();
  }, []);

  useEffect(() => {
    setXaiTeamIdInput(settings.xaiTeamId || "");
  }, [settings.xaiTeamId]);

  useEffect(() => {
    void (async () => {
      const key = await getXaiManagementApiKey();
      setHasXaiManagementKey(Boolean(key));
    })();
  }, []);

  useEffect(() => {
    const unsubscribe = useAIChatStore.subscribe((state) => {
      setSessionConfigOptions(state.sessionConfigOptions);
    });
    setSessionConfigOptions(useAIChatStore.getState().sessionConfigOptions);
    return unsubscribe;
  }, []);

  // Sync Ollama base URL + API key on mount
  useEffect(() => {
    const url = settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL;
    setOllamaBaseUrl(url);
    void (async () => {
      const token = await getProviderApiToken("ollama");
      setHasStoredOllamaKey(!!token);
      setOllamaApiKey(token);
    })();
  }, []);

  const validateOllamaConnection = useCallback(
    async (url: string, apiKey?: string | null) => {
      setOllamaStatus("checking");
      const keyToUse =
        apiKey !== undefined
          ? apiKey
          : hasStoredOllamaKey
            ? await getProviderApiToken("ollama")
            : null;
      const ok = await checkOllamaConnection(url, keyToUse);
      setOllamaStatus(ok ? "ok" : "error");
    },
    [hasStoredOllamaKey],
  );

  const handleOllamaUrlChange = (value: string) => {
    setOllamaUrl(value);
    setOllamaStatus("idle");

    if (ollamaDebounceRef.current) clearTimeout(ollamaDebounceRef.current);
    ollamaDebounceRef.current = setTimeout(() => {
      const trimmed = value.replace(/\/+$/, "") || DEFAULT_OLLAMA_BASE_URL;
      updateSetting("ollamaBaseUrl", trimmed);
      setOllamaBaseUrl(trimmed);
      void validateOllamaConnection(trimmed);
    }, 600);
  };

  const handleResetOllamaUrl = () => {
    setOllamaUrl(DEFAULT_OLLAMA_BASE_URL);
    updateSetting("ollamaBaseUrl", DEFAULT_OLLAMA_BASE_URL);
    setOllamaBaseUrl(DEFAULT_OLLAMA_BASE_URL);
    void validateOllamaConnection(DEFAULT_OLLAMA_BASE_URL);
  };

  const handleUseOllamaCloud = () => {
    setOllamaUrl(OLLAMA_CLOUD_BASE_URL);
    updateSetting("ollamaBaseUrl", OLLAMA_CLOUD_BASE_URL);
    setOllamaBaseUrl(OLLAMA_CLOUD_BASE_URL);
    void validateOllamaConnection(OLLAMA_CLOUD_BASE_URL);
  };

  const handleSaveOllamaApiKey = async () => {
    const trimmed = ollamaApiKeyInput.trim();
    if (!trimmed) return;
    setIsSavingOllamaKey(true);
    try {
      await storeProviderApiToken("ollama", trimmed);
      setOllamaApiKey(trimmed);
      setHasStoredOllamaKey(true);
      setOllamaApiKeyInput("");
      showToast({ message: "Ollama API key saved", type: "success" });
      void validateOllamaConnection(ollamaUrl, trimmed);
    } catch {
      showToast({ message: "Failed to save Ollama API key", type: "error" });
    } finally {
      setIsSavingOllamaKey(false);
    }
  };

  const handleRemoveOllamaApiKey = async () => {
    try {
      await removeProviderApiToken("ollama");
      setOllamaApiKey(null);
      setHasStoredOllamaKey(false);
      setOllamaApiKeyInput("");
      showToast({ message: "Ollama API key removed", type: "success" });
      void validateOllamaConnection(ollamaUrl, null);
    } catch {
      showToast({ message: "Failed to remove Ollama API key", type: "error" });
    }
  };

  const providers = getAvailableProviders();

  const handleProviderChange = (newProviderId: string) => {
    const provider = providers.find((p) => p.id === newProviderId);
    updateSetting("aiProviderId", newProviderId);
    if (newProviderId === CUSTOM_CHAT_PROVIDER_ID) {
      updateSetting("aiModelId", settings.aiCustomModelId || settings.aiAutocompleteCustomModelId);
      return;
    }
    if (provider && provider.models.length > 0) {
      updateSetting("aiModelId", provider.models[0].id);
    }
  };

  const loadAutocompleteModels = async () => {
    setIsLoadingAutocompleteModels(true);
    setAutocompleteModelError(null);
    try {
      const models = await fetchAutocompleteModels();
      if (models.length > 0) {
        setAutocompleteModels(models);
        setAutocompleteModelError(null);
        if (!models.some((model) => model.id === settings.aiAutocompleteModelId)) {
          updateSetting("aiAutocompleteModelId", resolveAutocompleteDefaultModelId(models));
        }
      } else {
        setAutocompleteModels([]);
        setAutocompleteModelError("Model list is empty. Refresh to try again.");
      }
    } catch {
      setAutocompleteModels([]);
      setAutocompleteModelError("Could not load model list. Refresh to try again.");
    } finally {
      setIsLoadingAutocompleteModels(false);
    }
  };

  useEffect(() => {
    void loadAutocompleteModels();
  }, []);

  useEffect(() => {
    setCustomAutocompleteModelInput(settings.aiAutocompleteCustomModelId);
  }, [settings.aiAutocompleteCustomModelId]);

  useEffect(() => {
    setCustomAutocompleteBaseUrlInput(settings.aiAutocompleteCustomBaseUrl);
  }, [settings.aiAutocompleteCustomBaseUrl]);

  useEffect(() => {
    setCustomChatBaseUrlInput(settings.aiCustomBaseUrl);
  }, [settings.aiCustomBaseUrl]);

  useEffect(() => {
    void (async () => {
      const token = await getProviderApiToken(CUSTOM_AUTOCOMPLETE_PROVIDER_ID);
      setHasCustomAutocompleteApiKey(Boolean(token));
      const customChatToken = await getProviderApiToken(CUSTOM_CHAT_PROVIDER_ID);
      setHasCustomChatApiKey(Boolean(customChatToken));
    })();
  }, []);

  const handleSaveCustomAutocompleteApiKey = async () => {
    const token = customAutocompleteApiKeyInput.trim();
    if (!token) return;

    setIsSavingCustomAutocompleteApiKey(true);
    try {
      await storeProviderApiToken(CUSTOM_AUTOCOMPLETE_PROVIDER_ID, token);
      setHasCustomAutocompleteApiKey(true);
      setCustomAutocompleteApiKeyInput("");
      showToast({ message: "Custom autocomplete API key saved", type: "success" });
    } catch {
      showToast({ message: "Failed to save custom autocomplete API key", type: "error" });
    } finally {
      setIsSavingCustomAutocompleteApiKey(false);
    }
  };

  const handleRemoveCustomAutocompleteApiKey = async () => {
    setIsSavingCustomAutocompleteApiKey(true);
    try {
      await removeProviderApiToken(CUSTOM_AUTOCOMPLETE_PROVIDER_ID);
      setHasCustomAutocompleteApiKey(false);
      setCustomAutocompleteApiKeyInput("");
      showToast({ message: "Custom autocomplete API key removed", type: "success" });
    } catch {
      showToast({ message: "Failed to remove custom autocomplete API key", type: "error" });
    } finally {
      setIsSavingCustomAutocompleteApiKey(false);
    }
  };

  const handleSaveCustomChatApiKey = async () => {
    const token = customChatApiKeyInput.trim();
    if (!token) return;

    setIsSavingCustomChatApiKey(true);
    try {
      await storeProviderApiToken(CUSTOM_CHAT_PROVIDER_ID, token);
      setHasCustomChatApiKey(true);
      setCustomChatApiKeyInput("");
      showToast({ message: "Custom provider API key saved", type: "success" });
    } catch {
      showToast({ message: "Failed to save custom provider API key", type: "error" });
    } finally {
      setIsSavingCustomChatApiKey(false);
    }
  };

  const handleRemoveCustomChatApiKey = async () => {
    setIsSavingCustomChatApiKey(true);
    try {
      await removeProviderApiToken(CUSTOM_CHAT_PROVIDER_ID);
      setHasCustomChatApiKey(false);
      setCustomChatApiKeyInput("");
      showToast({ message: "Custom provider API key removed", type: "success" });
    } catch {
      showToast({ message: "Failed to remove custom provider API key", type: "error" });
    } finally {
      setIsSavingCustomChatApiKey(false);
    }
  };

  const commitCustomChatBaseUrl = () => {
    updateSetting("aiCustomBaseUrl", customChatBaseUrlInput);
    setCustomProviderBaseUrl(customChatBaseUrlInput);
  };

  const commitCustomAutocompleteModel = () => {
    updateSetting("aiAutocompleteCustomModelId", customAutocompleteModelInput);
  };

  const commitCustomAutocompleteBaseUrl = () => {
    updateSetting("aiAutocompleteCustomBaseUrl", customAutocompleteBaseUrlInput);
  };

  const grokAuth = useAIChatStore((state) => state.grokAuth);
  const signInWithXai = useAIChatStore((state) => state.signInWithXai);
  const cancelXaiSignIn = useAIChatStore((state) => state.cancelXaiSignIn);
  const signOutXai = useAIChatStore((state) => state.signOutXai);
  const checkGrokAuthSession = useAIChatStore((state) => state.checkGrokAuthSession);
  const hasGrokCredential = useAIChatStore((state) => state.hasProviderApiKey("grok"));

  useEffect(() => {
    void checkGrokAuthSession();
  }, [checkGrokAuthSession]);

  const isOllamaSelected = settings.aiProviderId === "ollama";
  const isCustomProviderSelected = settings.aiProviderId === CUSTOM_CHAT_PROVIDER_ID;
  const showCustomProviderSettings =
    isCustomProviderSelected || Boolean(settings.aiCustomBaseUrl || settings.aiCustomModelId);
  const hasAutocompleteModels = autocompleteModels.length > 0;

  return (
    <div className="space-y-4">
      <Section title="Athas Agent">
        <SettingRow
          label="Provider"
          description="Choose the provider used by Athas Agent"
          onReset={() => {
            updateSetting("aiProviderId", getDefaultSetting("aiProviderId"));
            updateSetting("aiModelId", getDefaultSetting("aiModelId"));
          }}
          canReset={
            settings.aiProviderId !== getDefaultSetting("aiProviderId") ||
            settings.aiModelId !== getDefaultSetting("aiModelId")
          }
        >
          <ProviderSelector
            providerId={settings.aiProviderId}
            onChange={(id) => handleProviderChange(id)}
          />
        </SettingRow>

        <SettingRow
          label="Model"
          description={
            isCustomProviderSelected
              ? "Model name sent to the custom endpoint"
              : "Choose the model used by Athas Agent"
          }
          onReset={() => {
            if (isCustomProviderSelected) {
              updateSetting("aiCustomModelId", getDefaultSetting("aiCustomModelId"));
              updateSetting("aiModelId", getDefaultSetting("aiCustomModelId"));
              return;
            }
            updateSetting("aiModelId", getDefaultSetting("aiModelId"));
          }}
          canReset={
            isCustomProviderSelected
              ? settings.aiCustomModelId !== getDefaultSetting("aiCustomModelId")
              : settings.aiModelId !== getDefaultSetting("aiModelId")
          }
        >
          {isCustomProviderSelected ? (
            <ModelSelector
              providerId={settings.aiProviderId}
              modelId={settings.aiModelId || settings.aiCustomModelId}
              onChange={(id) => {
                updateSetting("aiCustomModelId", id);
                updateSetting("aiModelId", id);
              }}
            />
          ) : (
            <ModelSelector
              providerId={settings.aiProviderId}
              modelId={settings.aiModelId}
              onChange={(id) => updateSetting("aiModelId", id)}
            />
          )}
        </SettingRow>

        <SettingRow label="API Keys" description="Manage provider API keys separately">
          <Button
            type="button"
            variant="default"
            onClick={() => setIsApiKeyManagerOpen(true)}
            className="w-fit"
          >
            <Key />
            <span>Manage keys</span>
          </Button>
        </SettingRow>
      </Section>

      {showCustomProviderSettings && (
        <Section title="Custom Provider">
          <SettingRow
            label="Base URL"
            description="OpenAI-compatible endpoint base URL for Athas Agent"
            onReset={() => {
              updateSetting("aiCustomBaseUrl", getDefaultSetting("aiCustomBaseUrl"));
              setCustomProviderBaseUrl(getDefaultSetting("aiCustomBaseUrl"));
            }}
            canReset={settings.aiCustomBaseUrl !== getDefaultSetting("aiCustomBaseUrl")}
          >
            <Input
              value={customChatBaseUrlInput}
              onChange={(event) => setCustomChatBaseUrlInput(event.currentTarget.value)}
              onBlur={commitCustomChatBaseUrl}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              placeholder="http://localhost:11434/v1"
              size="xs"
              className={SETTINGS_CONTROL_WIDTHS.xwide}
              spellCheck={false}
              leftIcon={Globe}
            />
          </SettingRow>
          <SettingRow
            label="API Key"
            description={
              hasCustomChatApiKey
                ? "Stored securely. Leave blank to keep the existing key."
                : "Optional bearer token for the custom endpoint"
            }
          >
            <div className="flex items-center gap-2">
              <Input
                type="password"
                value={customChatApiKeyInput}
                onChange={(event) => setCustomChatApiKeyInput(event.currentTarget.value)}
                placeholder={hasCustomChatApiKey ? "Saved" : "API key"}
                size="xs"
                className={SETTINGS_CONTROL_WIDTHS.wide}
                spellCheck={false}
                autoComplete="off"
                disabled={isSavingCustomChatApiKey}
              />
              <Button
                type="button"
                variant="default"
                onClick={handleSaveCustomChatApiKey}
                disabled={!customChatApiKeyInput.trim() || isSavingCustomChatApiKey}
                compact
              >
                Save
              </Button>
              {hasCustomChatApiKey && (
                <Button
                  type="button"
                  variant="default"
                  onClick={handleRemoveCustomChatApiKey}
                  disabled={isSavingCustomChatApiKey}
                  compact
                >
                  Remove
                </Button>
              )}
            </div>
          </SettingRow>
        </Section>
      )}

      {(isOllamaSelected || settings.ollamaBaseUrl !== DEFAULT_OLLAMA_BASE_URL) && (
        <Section title="Ollama">
          <SettingRow label="Mode" description="Run Ollama locally or use Ollama Cloud">
            <SegmentedControl
              value={isOllamaCloud ? "cloud" : "local"}
              onChange={(nextValue) => {
                if (nextValue === "local") {
                  handleResetOllamaUrl();
                  return;
                }
                handleUseOllamaCloud();
              }}
              options={[
                { value: "local", label: "Local", icon: <Laptop /> },
                { value: "cloud", label: "Cloud", icon: <Cloud /> },
              ]}
            />
          </SettingRow>
          <SettingRow
            label="Endpoint"
            description="Base URL for Ollama API (local, LAN, or cloud)"
            onReset={handleResetOllamaUrl}
            canReset={settings.ollamaBaseUrl !== getDefaultSetting("ollamaBaseUrl")}
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Input
                type="text"
                value={ollamaUrl}
                onChange={(e) => handleOllamaUrlChange(e.target.value)}
                placeholder={DEFAULT_OLLAMA_BASE_URL}
                spellCheck={false}
                leftIcon={Globe}
                className={cn("w-56 max-w-full", ollamaStatus === "error" && "border-error/60")}
              />
              {ollamaStatus === "checking" && <LoadingIndicator label="Checking" compact />}
              {ollamaStatus === "ok" && <CheckCircle className="text-success" />}
              {ollamaStatus === "error" && <AlertCircle className="text-error" />}
              {ollamaUrl !== DEFAULT_OLLAMA_BASE_URL && (
                <Button
                  type="button"
                  variant="default"
                  onClick={handleResetOllamaUrl}
                  title="Reset to default"
                  aria-label="Reset Ollama URL to default"
                  compact
                >
                  <RotateCcw />
                </Button>
              )}
            </div>
          </SettingRow>
          <SettingRow
            label="API Key"
            description="Used for authenticated Ollama endpoints and Ollama Cloud."
          >
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <Input
                type="password"
                value={ollamaApiKeyInput}
                onChange={(e) => setOllamaApiKeyInput(e.target.value)}
                placeholder={hasStoredOllamaKey ? "••••••••  (saved)" : "ollama-…"}
                spellCheck={false}
                leftIcon={Key}
                className={cn(
                  "w-56 max-w-full",
                  needsApiKey && !hasStoredOllamaKey && "border-warning/60",
                )}
                autoComplete="off"
                disabled={isSavingOllamaKey}
              />
              <Button
                type="button"
                variant="default"
                onClick={handleSaveOllamaApiKey}
                disabled={!ollamaApiKeyInput.trim() || isSavingOllamaKey}
                compact
              >
                {isSavingOllamaKey ? "Saving…" : "Save"}
              </Button>
              {hasStoredOllamaKey && (
                <Button
                  type="button"
                  variant="default"
                  onClick={handleRemoveOllamaApiKey}
                  title="Remove saved API key"
                  aria-label="Remove Ollama API key"
                  className="text-error hover:bg-error/10"
                  compact
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          </SettingRow>
          {needsApiKey && !hasStoredOllamaKey && (
            <SettingRow label="Ollama Cloud Key" description="Ollama Cloud requires an API key.">
              <div className="flex items-center gap-1.5">
                <AlertCircle className="shrink-0 text-warning" />
                <a
                  href="https://ollama.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-link hover:underline"
                >
                  Get key <ExternalLink className="size-3" />
                </a>
              </div>
            </SettingRow>
          )}
          {ollamaStatus === "error" && (
            <SettingRow
              label="Connection Status"
              description={
                isOllamaCloud
                  ? "Could not reach Ollama Cloud. Verify your API key and internet connection."
                  : "Could not connect. Check that Ollama is running at this address."
              }
            >
              <Badge variant="default" size="default">
                Error
              </Badge>
            </SettingRow>
          )}
        </Section>
      )}

      <ProviderApiKeyCommand
        isOpen={isApiKeyManagerOpen}
        onClose={() => setIsApiKeyManagerOpen(false)}
        initialProviderId={settings.aiProviderId}
      />

      <Section title="Authentication">
        <SettingRow
          label="xAI Grok"
          description={
            grokAuth.hasOAuthSession
              ? "Signed in with your xAI account. API keys remain available as a fallback."
              : hasGrokCredential
                ? "Using a saved API key. You can also sign in with xAI."
                : "Sign in with xAI via device code, or add an API key as a fallback."
          }
        >
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-1.5">
              {grokAuth.hasOAuthSession ? (
                <>
                  <Badge variant="default" size="default">
                    Signed in
                  </Badge>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      void signOutXai()
                        .then(() => {
                          showToast({ message: "Signed out of xAI", type: "success" });
                        })
                        .catch(() => {
                          showToast({ message: "Failed to sign out of xAI", type: "error" });
                        });
                    }}
                    className="text-error hover:bg-error/10 hover:text-error"
                  >
                    Sign out
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="accent"
                  onClick={() => {
                    void signInWithXai().then((signedIn) => {
                      if (signedIn) {
                        showToast({ message: "Signed in with xAI", type: "success" });
                      }
                    });
                  }}
                  disabled={grokAuth.isSigningIn}
                >
                  {grokAuth.isSigningIn ? "Waiting for browser..." : "Sign in with xAI"}
                </Button>
              )}
            </div>
            {grokAuth.isSigningIn && grokAuth.userCode ? (
              <div className="max-w-xs text-right ui-text-xs text-text-lighter">
                <div>
                  Confirm code <span className="font-medium text-text">{grokAuth.userCode}</span> in
                  your browser.
                </div>
                <div className="mt-1 flex justify-end gap-2">
                  {grokAuth.verificationUri ? (
                    <a
                      href={grokAuth.verificationUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-text-lighter hover:text-text"
                    >
                      Open login page
                    </a>
                  ) : null}
                  <button
                    type="button"
                    className="text-error hover:text-error/80"
                    onClick={cancelXaiSignIn}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {grokAuth.error ? (
              <div className="max-w-xs text-right ui-text-xs text-error">{grokAuth.error}</div>
            ) : null}
          </div>
        </SettingRow>

        <SettingRow
          label="xAI Team ID"
          description="Required for the footer Grok usage meter via the Management/Billing API."
        >
          <Input
            value={xaiTeamIdInput}
            onChange={(event) => setXaiTeamIdInput(event.currentTarget.value)}
            onBlur={() => updateSetting("xaiTeamId", xaiTeamIdInput.trim())}
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            size="xs"
            className={SETTINGS_CONTROL_WIDTHS.textWide}
          />
        </SettingRow>

        <SettingRow
          label="xAI Management Key"
          description="Separate from chat API keys. Used only to fetch prepaid usage for the footer meter."
        >
          <div className="flex items-center gap-1.5">
            <Input
              type="password"
              value={xaiManagementKeyInput}
              onChange={(event) => setXaiManagementKeyInput(event.currentTarget.value)}
              placeholder={hasXaiManagementKey ? "Saved" : "Management API key"}
              size="xs"
              className={SETTINGS_CONTROL_WIDTHS.textWide}
            />
            {hasXaiManagementKey ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  void (async () => {
                    try {
                      await removeXaiManagementApiKey();
                      setHasXaiManagementKey(false);
                      setXaiManagementKeyInput("");
                      showToast({ message: "xAI management key removed", type: "success" });
                    } catch {
                      showToast({ message: "Failed to remove xAI management key", type: "error" });
                    }
                  })();
                }}
                title="Remove saved management key"
                aria-label="Remove xAI management key"
                className="text-error hover:bg-error/10"
              >
                <Trash2 />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="default"
              disabled={!xaiManagementKeyInput.trim() || isSavingXaiManagementKey}
              onClick={() => {
                void (async () => {
                  const key = xaiManagementKeyInput.trim();
                  if (!key) return;
                  setIsSavingXaiManagementKey(true);
                  try {
                    await storeXaiManagementApiKey(key);
                    setHasXaiManagementKey(true);
                    setXaiManagementKeyInput("");
                    showToast({ message: "xAI management key saved", type: "success" });
                  } catch {
                    showToast({ message: "Failed to save xAI management key", type: "error" });
                  } finally {
                    setIsSavingXaiManagementKey(false);
                  }
                })();
              }}
            >
              {isSavingXaiManagementKey ? "Saving..." : "Save"}
            </Button>
          </div>
        </SettingRow>
      </Section>

      <Section title="Skills marketplace">
        <SettingRow
          label="Browse skills"
          description="Install reusable AI skills from the Athas skills registry. Installed skills can be auto-activated as tools in Chat/Plan/Agent modes."
        >
          <Button type="button" variant="default" onClick={() => setIsSkillsMarketplaceOpen(true)}>
            Open skills marketplace
          </Button>
        </SettingRow>
      </Section>

      <McpMarketplaceSection />

      <SkillsCommand
        isOpen={isSkillsMarketplaceOpen}
        onClose={() => setIsSkillsMarketplaceOpen(false)}
        onSelectSkill={() => setIsSkillsMarketplaceOpen(false)}
        initialView="browse"
      />

      {sessionConfigOptions.length > 0 && (
        <Section title="ACP Session">
          {sessionConfigOptions.map((option) => {
            if (option.kind.type !== "select") {
              return null;
            }

            return (
              <SettingRow
                key={option.id}
                label={option.name}
                description={option.description || "Session option exposed by the active ACP agent"}
              >
                <Select
                  value={option.kind.currentValue}
                  options={option.kind.options.map((value) => ({
                    value: value.id,
                    label: value.name,
                  }))}
                  onChange={(value) =>
                    useAIChatStore.getState().changeSessionConfigOption(option.id, value)
                  }
                  size="xs"
                  variant="default"
                  searchable
                  searchableTrigger="input"
                />
              </SettingRow>
            );
          })}
        </Section>
      )}

      <Section title="Autocomplete">
        <SettingRow
          label="AI Autocomplete"
          description="Enable AI autocomplete while typing"
          onReset={() => updateSetting("aiCompletion", getDefaultSetting("aiCompletion"))}
          canReset={settings.aiCompletion !== getDefaultSetting("aiCompletion")}
        >
          <Switch
            checked={aiCompletionAllowedByPolicy ? settings.aiCompletion : false}
            onChange={(checked) => updateSetting("aiCompletion", checked)}
            disabled={!aiCompletionAllowedByPolicy}
            size="sm"
          />
        </SettingRow>
        {settings.aiCompletion && (
          <>
            <SettingRow
              label="Autocomplete Provider"
              description="Use Athas/OpenRouter or an OpenAI-compatible endpoint"
              onReset={() =>
                updateSetting("aiAutocompleteProvider", getDefaultSetting("aiAutocompleteProvider"))
              }
              canReset={
                settings.aiAutocompleteProvider !== getDefaultSetting("aiAutocompleteProvider")
              }
            >
              <SegmentedControl
                value={settings.aiAutocompleteProvider}
                options={[
                  { value: "openrouter", label: "OpenRouter" },
                  { value: "custom", label: "Custom" },
                ]}
                onChange={(value) =>
                  updateSetting(
                    "aiAutocompleteProvider",
                    value === "custom" ? "custom" : "openrouter",
                  )
                }
                size="xs"
                wrap={false}
              />
            </SettingRow>
            <SettingRow
              label={
                settings.aiAutocompleteProvider === "custom" ? "Custom Model" : "Autocomplete Model"
              }
              description={
                settings.aiAutocompleteProvider === "custom"
                  ? "Model name sent to the custom endpoint"
                  : "Choose any OpenRouter model for autocomplete"
              }
              onReset={() =>
                settings.aiAutocompleteProvider === "custom"
                  ? updateSetting(
                      "aiAutocompleteCustomModelId",
                      getDefaultSetting("aiAutocompleteCustomModelId"),
                    )
                  : updateSetting(
                      "aiAutocompleteModelId",
                      getDefaultSetting("aiAutocompleteModelId"),
                    )
              }
              canReset={
                settings.aiAutocompleteProvider === "custom"
                  ? settings.aiAutocompleteCustomModelId !==
                    getDefaultSetting("aiAutocompleteCustomModelId")
                  : settings.aiAutocompleteModelId !== getDefaultSetting("aiAutocompleteModelId")
              }
            >
              {settings.aiAutocompleteProvider === "custom" ? (
                <Input
                  value={customAutocompleteModelInput}
                  onChange={(event) => setCustomAutocompleteModelInput(event.currentTarget.value)}
                  onBlur={commitCustomAutocompleteModel}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="qwen2.5-coder:7b"
                  size="xs"
                  className={SETTINGS_CONTROL_WIDTHS.xwide}
                  disabled={!aiCompletionAllowedByPolicy}
                />
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    variant="default"
                    onClick={loadAutocompleteModels}
                    disabled={isLoadingAutocompleteModels || !aiCompletionAllowedByPolicy}
                    title="Refresh model list"
                    compact
                  >
                    {isLoadingAutocompleteModels ? (
                      <LoadingIndicator label="Loading models" compact />
                    ) : (
                      <RefreshCw />
                    )}
                  </Button>
                  <Select
                    value={hasAutocompleteModels ? settings.aiAutocompleteModelId : ""}
                    options={autocompleteModels.map((model) => ({
                      value: model.id,
                      label: model.name,
                    }))}
                    onChange={(value) => updateSetting("aiAutocompleteModelId", value)}
                    size="xs"
                    variant="default"
                    searchable
                    searchableTrigger="input"
                    className={SETTINGS_CONTROL_WIDTHS.xwide}
                    disabled={
                      !aiCompletionAllowedByPolicy ||
                      isLoadingAutocompleteModels ||
                      !hasAutocompleteModels
                    }
                    placeholder={
                      isLoadingAutocompleteModels ? "Loading models..." : "No models loaded"
                    }
                  />
                </div>
              )}
            </SettingRow>
            {settings.aiAutocompleteProvider === "custom" && (
              <>
                <SettingRow
                  label="Custom Base URL"
                  description="OpenAI-compatible endpoint base URL"
                  onReset={() =>
                    updateSetting(
                      "aiAutocompleteCustomBaseUrl",
                      getDefaultSetting("aiAutocompleteCustomBaseUrl"),
                    )
                  }
                  canReset={
                    settings.aiAutocompleteCustomBaseUrl !==
                    getDefaultSetting("aiAutocompleteCustomBaseUrl")
                  }
                >
                  <Input
                    value={customAutocompleteBaseUrlInput}
                    onChange={(event) =>
                      setCustomAutocompleteBaseUrlInput(event.currentTarget.value)
                    }
                    onBlur={commitCustomAutocompleteBaseUrl}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder="http://localhost:11434/v1"
                    size="xs"
                    className={SETTINGS_CONTROL_WIDTHS.xwide}
                    disabled={!aiCompletionAllowedByPolicy}
                  />
                </SettingRow>
                <SettingRow
                  label="Custom API Key"
                  description={
                    hasCustomAutocompleteApiKey
                      ? "Stored securely. Leave blank to keep the existing key."
                      : "Optional bearer token for the custom endpoint"
                  }
                >
                  <div className="flex items-center gap-2">
                    <Input
                      type="password"
                      value={customAutocompleteApiKeyInput}
                      onChange={(event) =>
                        setCustomAutocompleteApiKeyInput(event.currentTarget.value)
                      }
                      placeholder={hasCustomAutocompleteApiKey ? "Saved" : "API key"}
                      size="xs"
                      className={SETTINGS_CONTROL_WIDTHS.wide}
                      disabled={!aiCompletionAllowedByPolicy || isSavingCustomAutocompleteApiKey}
                    />
                    <Button
                      variant="default"
                      onClick={handleSaveCustomAutocompleteApiKey}
                      disabled={
                        !customAutocompleteApiKeyInput.trim() ||
                        !aiCompletionAllowedByPolicy ||
                        isSavingCustomAutocompleteApiKey
                      }
                      compact
                    >
                      Save
                    </Button>
                    {hasCustomAutocompleteApiKey && (
                      <Button
                        variant="default"
                        onClick={handleRemoveCustomAutocompleteApiKey}
                        disabled={!aiCompletionAllowedByPolicy || isSavingCustomAutocompleteApiKey}
                        compact
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                </SettingRow>
              </>
            )}
            {autocompleteModelError && (
              <SettingRow label="Model List" description={autocompleteModelError}>
                <Badge variant="default" size="default">
                  Error
                </Badge>
              </SettingRow>
            )}
          </>
        )}
        {managedPolicy ? (
          <SettingRow
            label="Enterprise Policy"
            description={`${aiCompletionAllowedByPolicy ? "AI completion enabled." : "AI completion disabled."} ${byokAllowedByPolicy ? "BYOK allowed." : "BYOK blocked."}`}
          >
            <Badge variant="default" size="default">
              Managed
            </Badge>
          </SettingRow>
        ) : null}
      </Section>

      <Section title="Chat History">
        <SettingRow label="Clear All Chats" description="Permanently delete all chat history">
          <TypedConfirmAction
            actionLabel="Clear All"
            busyLabel="Clearing..."
            isBusy={isClearingChats}
            onConfirm={async () => {
              setIsClearingChats(true);
              try {
                await useAIChatStore.getState().clearAllChats();
                showToast({ message: "All chats cleared", type: "success" });
              } finally {
                setIsClearingChats(false);
              }
            }}
          />
        </SettingRow>
      </Section>
    </div>
  );
};
