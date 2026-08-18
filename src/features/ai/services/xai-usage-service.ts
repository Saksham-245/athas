import { providerFetch } from "@/features/ai/services/providers/provider-fetch";
import {
  getProviderApiToken,
  removeProviderApiToken,
  storeProviderApiToken,
} from "@/features/ai/services/ai-token-service";

export const XAI_MANAGEMENT_PROVIDER_ID = "xai-management";

export type XaiUsageSummary = {
  teamId: string;
  billingYear: number | null;
  billingMonth: number | null;
  prepaidCreditsCents: number;
  prepaidCreditsUsedCents: number;
  remainingCreditsCents: number;
  effectiveSpendingLimitCents: number | null;
  defaultCreditsCents: number | null;
  fetchedAt: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function parseCents(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
    return Math.round(Number(value));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.val === "string" || typeof record.val === "number") {
      return parseCents(record.val);
    }
  }
  return null;
}

export async function getXaiManagementApiKey(): Promise<string | null> {
  return getProviderApiToken(XAI_MANAGEMENT_PROVIDER_ID);
}

export async function storeXaiManagementApiKey(apiKey: string): Promise<void> {
  await storeProviderApiToken(XAI_MANAGEMENT_PROVIDER_ID, apiKey.trim());
}

export async function removeXaiManagementApiKey(): Promise<void> {
  await removeProviderApiToken(XAI_MANAGEMENT_PROVIDER_ID);
}

export async function fetchXaiTeamUsage(params: {
  teamId: string;
  managementApiKey?: string | null;
}): Promise<XaiUsageSummary> {
  const teamId = params.teamId.trim();
  if (!teamId) {
    throw new Error("xAI team ID is required.");
  }

  const managementApiKey =
    params.managementApiKey?.trim() || (await getXaiManagementApiKey()) || "";
  if (!managementApiKey) {
    throw new Error("xAI management API key is required.");
  }

  const response = await providerFetch(
    `https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(teamId)}/prepaid/balance`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${managementApiKey}`,
        Accept: "application/json",
      },
    },
  );

  const payload = asRecord(await response.json().catch(() => null));
  if (!response.ok) {
    const message =
      (typeof payload?.message === "string" && payload.message) ||
      (typeof payload?.error === "string" && payload.error) ||
      `Failed to fetch xAI usage (${response.status})`;
    throw new Error(message);
  }

  const coreInvoice = asRecord(payload?.coreInvoice);
  const billingCycle = asRecord(payload?.billingCycle);
  const prepaidCreditsCents = Math.abs(parseCents(coreInvoice?.prepaidCredits) ?? 0);
  const prepaidCreditsUsedCents = Math.abs(parseCents(coreInvoice?.prepaidCreditsUsed) ?? 0);
  const remainingCreditsCents = Math.max(0, prepaidCreditsCents - prepaidCreditsUsedCents);

  return {
    teamId,
    billingYear: typeof billingCycle?.year === "number" ? billingCycle.year : null,
    billingMonth: typeof billingCycle?.month === "number" ? billingCycle.month : null,
    prepaidCreditsCents,
    prepaidCreditsUsedCents,
    remainingCreditsCents,
    effectiveSpendingLimitCents: parseCents(payload?.effectiveSpendingLimit),
    defaultCreditsCents: parseCents(payload?.defaultCredits),
    fetchedAt: Date.now(),
  };
}

export function getXaiUsageProgress(usage: XaiUsageSummary | null): number {
  if (!usage || usage.prepaidCreditsCents <= 0) return 0;
  return Math.min(
    100,
    Math.max(0, (usage.prepaidCreditsUsedCents / usage.prepaidCreditsCents) * 100),
  );
}

export function formatXaiUsageLabel(usage: XaiUsageSummary | null): string {
  if (!usage) return "Usage";
  const remaining = usage.remainingCreditsCents / 100;
  const total = usage.prepaidCreditsCents / 100;
  if (total <= 0) {
    return `$${remaining.toFixed(remaining < 10 ? 2 : 0)} left`;
  }
  return `$${remaining.toFixed(remaining < 10 ? 2 : 0)} / $${total.toFixed(total < 10 ? 2 : 0)}`;
}
