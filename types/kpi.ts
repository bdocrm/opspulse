export type KpiStatus = "EXCEEDS_TARGET" | "MEETS_TARGET" | "NEAR_TARGET" | "BELOW_TARGET" | "NO_DATA";

export interface KpiRecord {
  id: string;
  employeeId: string;
  employeeNameSnapshot: string;
  campaignId: string;
  campaign: { id: string; campaignName: string };
  employee?: { id: string; name: string; seatNumber: number | null };
  month: number;
  year: number;
  tenure: string | null;
  actualQa: number | null;
  actualAht: number | null;
  actualAdherence: number | null;
  actualCm: number | null;
  actualCd: number | null;
  goalQa: number | null;
  goalAht: number | null;
  goalAdherence: number | null;
  goalCm: number | null;
  goalCd: number | null;
  achievementQa: number | null;
  achievementAht: number | null;
  achievementAdherence: number | null;
  achievementCm: number | null;
  achievementCd: number | null;
  overallScore: number | null;
  status: KpiStatus;
  metricStatuses: Record<"qa" | "aht" | "adherence" | "cm" | "cd", KpiStatus>;
}

export interface KpiPreviewRecord {
  rowKey: string;
  employeeName: string;
  employeeCode: string | null;
  matchedEmployeeId: string | null;
  matchedEmployeeName: string | null;
  matchConfidence: number | null;
  matchMethod: string | null;
  tenure: string | null;
  month: number;
  year: number;
  sourceSheet: string;
  sourceRow: number;
  actualQa: number | null;
  actualAht: number | null;
  actualAdherence: number | null;
  actualCm: number | null;
  actualCd: number | null;
  goalQa: number | null;
  goalAht: number | null;
  goalAdherence: number | null;
  goalCm: number | null;
  goalCd: number | null;
  errors: string[];
  warnings: string[];
  suggestions: Array<{ id: string; name: string; confidence: number }>;
  existingRecordId: string | null;
  duplicateWithinFile: boolean;
  status: "VALID" | "WARNING" | "INVALID" | "DUPLICATE" | "UNMATCHED";
  skipped?: boolean;
}
