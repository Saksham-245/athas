import { LightningIcon as Lightning } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import {
  fetchXaiUsage,
  formatXaiUsageLabel,
  getXaiUsageProgress,
  type XaiUsageSummary,
} from "@/features/ai/services/xai-usage-service";
import {
  chromeControl,
  chromeIcon,
} from "@/features/layout/components/chrome-control-styles";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { formatUsdFromCents } from "@/features/window/lib/account-usage";
import { cn } from "@/utils/cn";
import Tooltip from "@/ui/tooltip";

export function AiUsageFooterItem() {
  const aiProviderId = useSettingsStore((state) => state.settings.aiProviderId);
  const [usage, setUsage] = useState<XaiUsageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const shouldShow = aiProviderId === "grok";

  useEffect(() => {
    if (!shouldShow) {
      setUsage(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const loadUsage = async () => {
      setIsLoading(true);
      try {
        const nextUsage = await fetchXaiUsage();
        if (!cancelled) {
          setUsage(nextUsage);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setUsage(null);
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Failed to load xAI usage",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadUsage();
    const interval = window.setInterval(() => {
      void loadUsage();
    }, 60_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [shouldShow]);

  const progress = useMemo(() => getXaiUsageProgress(usage), [usage]);
  const label = useMemo(() => formatXaiUsageLabel(usage), [usage]);

  if (!shouldShow) {
    return null;
  }

  const tooltip = usage
    ? [
        "Grok prepaid usage",
        `Remaining: ${formatUsdFromCents(usage.remainingCreditsCents)}`,
        `Used: ${formatUsdFromCents(usage.prepaidCreditsUsedCents)}`,
        `Total: ${formatUsdFromCents(usage.prepaidCreditsCents)}`,
        usage.billingMonth && usage.billingYear
          ? `Cycle: ${usage.billingYear}-${String(usage.billingMonth).padStart(2, "0")}`
          : null,
        usage.source === "session" ? "Source: signed-in xAI session" : "Source: management key",
      ]
        .filter(Boolean)
        .join("\n")
    : error || "Sign in with xAI to view Grok usage";

  return (
    <Tooltip content={tooltip} side="top">
      <div
        className={cn(
          chromeControl(),
          "flex h-6 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-text-lighter",
        )}
        aria-label="Grok usage"
      >
        <Lightning className={chromeIcon()} weight="duotone" />
        <div className="flex min-w-[72px] flex-col gap-0.5">
          <span className="ui-text-xs leading-none text-text-lighter">
            {isLoading && !usage ? "Usage…" : error && !usage ? "Sign in" : label}
          </span>
          <div className="h-1 overflow-hidden rounded-full bg-hover/70">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-[var(--app-duration-normal)] ease-[var(--app-ease-smooth)]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>
    </Tooltip>
  );
}
