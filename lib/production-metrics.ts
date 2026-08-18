import type { ProductionMetricType, ProductionStatus } from "@/types/production-monitoring";

export const PRODUCTION_STATUS_THRESHOLDS = {
  onTrack: 1,
  nearTarget: 0.9,
  atRisk: 0.75,
} as const;

export function calculateProductionAchievement(input: {
  target: number | null;
  mtd: number | null;
  metricType: ProductionMetricType;
}) {
  if (input.target == null || input.mtd == null || input.target === 0) return null;
  // Ratio-to-target is a safe fallback for the supported source formats. An
  // authoritative imported achievement always takes precedence over this.
  return input.mtd / input.target;
}

export function getProductionStatus(achievement: number | null): ProductionStatus {
  if (achievement == null || !Number.isFinite(achievement)) return "NO_DATA";
  if (achievement >= PRODUCTION_STATUS_THRESHOLDS.onTrack) return "ON_TRACK";
  if (achievement >= PRODUCTION_STATUS_THRESHOLDS.nearTarget) return "NEAR_TARGET";
  if (achievement >= PRODUCTION_STATUS_THRESHOLDS.atRisk) return "AT_RISK";
  return "BELOW_TARGET";
}

export function formatProductionMetric(
  value: number | null | undefined,
  metricType: ProductionMetricType | string,
  metricUnit?: string | null
) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (metricType === "percentage") {
    return new Intl.NumberFormat("en-US", {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 2,
    }).format(value);
  }
  if (metricType === "currency") {
    return new Intl.NumberFormat("en-PH", {
      style: "currency",
      currency: metricUnit === "USD" ? "USD" : "PHP",
      maximumFractionDigits: 2,
    }).format(value);
  }
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: metricType === "ratio" ? 2 : 2,
  }).format(value);
  return metricUnit && !["Units", "Items"].includes(metricUnit)
    ? `${formatted} ${metricUnit}`
    : formatted;
}

export function formatAchievement(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
  }).format(value);
}
