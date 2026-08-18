import { getGrokBearerToken } from "@/features/ai/services/xai-auth-service";
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
  source: "session" | "management";
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

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const json = atob(padded);
    return asRecord(JSON.parse(json));
  } catch {
    return null;
  }
}

function extractTeamIdFromClaims(claims: Record<string, unknown> | null): string | null {
  if (!claims) return null;

  const directCandidates = [
    claims.team_id,
    claims.teamId,
    claims.tid,
    claims.org_id,
    claims.orgId,
    claims.organization_id,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }

  const team = asRecord(claims.team);
  if (typeof team?.id === "string" && team.id.trim()) return team.id.trim();

  const org = asRecord(claims.organization) || asRecord(claims.org);
  if (typeof org?.id === "string" && org.id.trim()) return org.id.trim();

  return null;
}

async function listTeamIdsWithBearer(bearerToken: string): Promise<string[]> {
  const endpoints = [
    "https://management-api.x.ai/auth/teams",
    "https://management-api.x.ai/v1/teams",
    "https://management-api.x.ai/auth/user/teams",
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await providerFetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: "application/json",
        },
      });
      if (!response.ok) continue;
      const payload = await response.json().catch(() => null);
      const rows = Array.isArray(payload)
        ? payload
        : Array.isArray((payload as { teams?: unknown })?.teams)
          ? ((payload as { teams: unknown[] }).teams)
          : Array.isArray((payload as { data?: unknown })?.data)
            ? ((payload as { data: unknown[] }).data)
            : [];

      const ids = rows
        .map((row) => {
          const record = asRecord(row);
          if (!record) return null;
          if (typeof record.teamId === "string" && record.teamId.trim()) return record.teamId.trim();
          if (typeof record.team_id === "string" && record.team_id.trim()) return record.team_id.trim();
          if (typeof record.id === "string" && record.id.trim()) return record.id.trim();
          return null;
        })
        .filter((id): id is string => Boolean(id));

      if (ids.length > 0) return Array.from(new Set(ids));
    } catch {
      // try next endpoint
    }
  }

  return [];
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

export async function resolveXaiTeamIdForSession(bearerToken: string): Promise<string | null> {
  const fromJwt = extractTeamIdFromClaims(decodeJwtPayload(bearerToken));
  if (fromJwt) return fromJwt;

  const listed = await listTeamIdsWithBearer(bearerToken);
  return listed[0] || null;
}

async function fetchPrepaidBalance(params: {
  teamId: string;
  bearerToken: string;
  source: "session" | "management";
}): Promise<XaiUsageSummary> {
  const response = await providerFetch(
    `https://management-api.x.ai/v1/billing/teams/${encodeURIComponent(params.teamId)}/prepaid/balance`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${params.bearerToken}`,
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
    teamId: params.teamId,
    billingYear: typeof billingCycle?.year === "number" ? billingCycle.year : null,
    billingMonth: typeof billingCycle?.month === "number" ? billingCycle.month : null,
    prepaidCreditsCents,
    prepaidCreditsUsedCents,
    remainingCreditsCents,
    effectiveSpendingLimitCents: parseCents(payload?.effectiveSpendingLimit),
    defaultCreditsCents: parseCents(payload?.defaultCredits),
    fetchedAt: Date.now(),
    source: params.source,
  };
}

/** Preferred: use the signed-in Grok/xAI session. */
export async function fetchXaiSessionUsage(): Promise<XaiUsageSummary> {
  const sessionToken = await getGrokBearerToken();
  if (!sessionToken) {
    throw new Error("Sign in with xAI to view Grok usage.");
  }

  const teamId = await resolveXaiTeamIdForSession(sessionToken);
  if (!teamId) {
    throw new Error("Could not determine your xAI team from the signed-in session.");
  }

  return fetchPrepaidBalance({
    teamId,
    bearerToken: sessionToken,
    source: "session",
  });
}

/** Legacy fallback for management-key installs. */
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

  return fetchPrepaidBalance({
    teamId,
    bearerToken: managementApiKey,
    source: "management",
  });
}

export async function fetchXaiUsage(): Promise<XaiUsageSummary> {
  try {
    return await fetchXaiSessionUsage();
  } catch (sessionError) {
    // Fall back only if a management key was previously saved.
    const managementKey = await getXaiManagementApiKey();
    if (!managementKey) {
      throw sessionError instanceof Error
        ? sessionError
        : new Error("Failed to fetch xAI usage from signed-in session.");
    }

    // Try to reuse team id discovered from the session JWT/API if possible.
    const sessionToken = await getGrokBearerToken();
    const teamId = sessionToken ? await resolveXaiTeamIdForSession(sessionToken) : null;
    if (!teamId) {
      throw sessionError instanceof Error
        ? sessionError
        : new Error("Signed-in session usage failed and no team could be resolved.");
    }

    return fetchXaiTeamUsage({ teamId, managementApiKey: managementKey });
  }
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
