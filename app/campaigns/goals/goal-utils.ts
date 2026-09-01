import type { CampaignOption } from "@/types/campaign";

export interface Campaign extends CampaignOption {
  kpiMetric: string;
  monthlyGoal: number;
  supplementaryGoal: number;
  workingDays: number;
  daysLapsed: number;
  mtd: number;
  bookedVolume: number;
  achievement: number;
  runRate: number;
  rrAchievement: number;
  updatedAt?: string;
  hasMonthlyConfig?: boolean;
  users: Array<{
    id: string;
    name: string;
    seatNumber: number;
    monthlyTarget: number | null;
  }>;
}

export type AchievementStatus = "all" | "above" | "on-track" | "needs-attention" | "at-risk";
export type SortKey = "campaignName" | "kpiMetric" | "monthlyGoal" | "bookedVolume" | "mtd" | "achievement" | "runRate" | "rrAchievement" | "updatedAt";
export type SortDirection = "asc" | "desc";

export interface SavedGoal {
  campaignId: string;
  campaignName: string;
  month: number;
  year: number;
  monthlyGoal: number;
  kpiMetric: string;
  workingDays: number;
  daysLapsed: number;
  updatedAt: string;
  deletedAt?: string | null;
  deletedBy?: string | null;
  restoredAt?: string | null;
  restoredBy?: string | null;
}

type GoalKey = {
  campaignId: string;
  month: number;
  year: number;
};

export type ConfirmAction =
  | { type: "soft-delete"; items: GoalKey[] }
  | { type: "restore"; items: GoalKey[] }
  | { type: "permanent-delete"; items: GoalKey[] };

export const KPI_METRICS = [
  { value: "allKpi", label: "ALL KPI" },
  { value: "transmittals", label: "Transmittals" },
  { value: "approvals", label: "Approvals" },
  { value: "booked", label: "Booked" },
  { value: "activations", label: "Activations" },
  { value: "volume", label: "Volume" },
  { value: "transaction", label: "Transaction" },
  { value: "achievements", label: "Achievements" },
  { value: "qualityRate", label: "Quality Rate" },
  { value: "conversionRate", label: "Conversion Rate" },
];

export const BPI_KPI_VALUES = new Set(["transmittals", "approvals", "booked"]);
export const BPI_KPI_METRICS = KPI_METRICS.filter((metric) => BPI_KPI_VALUES.has(metric.value));

export function usesBpiThreeKpis(name?: string | null) {
  const normalized = String(name || "").trim().toUpperCase().replace(/\s+/g, " ");
  return normalized.startsWith("BPI ") && normalized !== "BPI PA OUTBOUND";
}

export function metricLabel(value: string) {
  return KPI_METRICS.find((metric) => metric.value === value)?.label || value;
}

export function isAcqCampaign(name?: string | null) {
  return /\bacq\b/i.test(name || "");
}

export function formatNumber(value: number) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export function stripNumberFormatting(value: string) {
  return value.replace(/,/g, "");
}

export function formatInputNumber(value: string | number, fractionDigits?: number) {
  const raw = stripNumberFormatting(String(value ?? ""));
  if (raw === "") return "";
  const number = Number(raw);
  if (Number.isNaN(number)) return String(value);
  return number.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits ?? 2,
  });
}

export function formatNumericTextValue(value: string) {
  const normalized = normalizeNumericInput(value);
  if (normalized === "") return "";

  const [integerPart, ...decimalParts] = normalized.split(".");
  const integer = integerPart === "" ? "0" : integerPart;
  const formattedInteger = Number(integer).toLocaleString();
  if (!normalized.includes(".")) return formattedInteger;
  return `${formattedInteger}.${decimalParts.join("")}`;
}

export function normalizeNumericInput(value: string) {
  return value.replace(/[^\d.]/g, "");
}

export function formatPct(value: number) {
  return `${Number(value || 0).toFixed(1)}%`;
}

export function statusForCampaign(campaign: Campaign): AchievementStatus {
  if (campaign.achievement >= 100) return "above";
  if (campaign.achievement >= 90 || campaign.rrAchievement >= 95) return "on-track";
  if (campaign.achievement >= 75 || campaign.rrAchievement >= 80) return "needs-attention";
  return "at-risk";
}

export function statusLabel(status: AchievementStatus) {
  if (status === "above") return "Above Goal";
  if (status === "on-track") return "On Track";
  if (status === "needs-attention") return "Needs Attention";
  if (status === "at-risk") return "At Risk";
  return "All";
}

export function statusClass(status: AchievementStatus) {
  if (status === "above") return "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/50 dark:text-green-300 dark:border-green-900";
  if (status === "on-track") return "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/50 dark:text-yellow-300 dark:border-yellow-900";
  if (status === "needs-attention") return "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-900";
  if (status === "at-risk") return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900";
  return "bg-muted text-muted-foreground border-border";
}

export function dashboardExportRows(rows: Campaign[]) {
  return rows.map((row) => ({
    Campaign: row.campaignName,
    "KPI Metric": metricLabel(row.kpiMetric),
    Goal: Number(row.monthlyGoal || 0),
    "Booked Volume": Number(row.bookedVolume || 0),
    MTD: Number(row.mtd || 0),
    "Achievement %": Number(row.achievement || 0).toFixed(1),
    "Run Rate": Number(row.runRate || 0),
    "RR Achievement %": Number(row.rrAchievement || 0).toFixed(1),
    Status: statusLabel(statusForCampaign(row)),
    "Last Updated": row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "",
  }));
}
