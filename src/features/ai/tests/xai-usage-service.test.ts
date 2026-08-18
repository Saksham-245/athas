import { describe, expect, it } from "vite-plus/test";
import {
  formatXaiUsageLabel,
  getXaiUsageProgress,
  type XaiUsageSummary,
} from "@/features/ai/services/xai-usage-service";

const sampleUsage: XaiUsageSummary = {
  teamId: "team-1",
  billingYear: 2026,
  billingMonth: 8,
  prepaidCreditsCents: 4500,
  prepaidCreditsUsedCents: 1200,
  remainingCreditsCents: 3300,
  effectiveSpendingLimitCents: 20000,
  defaultCreditsCents: 0,
  fetchedAt: Date.now(),
};

describe("xai usage service helpers", () => {
  it("computes usage progress from prepaid credits", () => {
    expect(getXaiUsageProgress(sampleUsage)).toBeCloseTo((1200 / 4500) * 100, 5);
    expect(getXaiUsageProgress(null)).toBe(0);
  });

  it("formats a compact remaining/total usage label", () => {
    expect(formatXaiUsageLabel(sampleUsage)).toBe("$33 / $45");
    expect(formatXaiUsageLabel(null)).toBe("Usage");
  });
});
