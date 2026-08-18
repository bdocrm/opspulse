export type ProductionMetricType =
  | "percentage"
  | "volume"
  | "count"
  | "currency"
  | "ratio"
  | "custom";

export type ProductionStatus =
  | "ON_TRACK"
  | "NEAR_TARGET"
  | "AT_RISK"
  | "BELOW_TARGET"
  | "NO_DATA";

export type ValidationLevel = "WARNING" | "ERROR";

export interface ProductionValidationIssue {
  level: ValidationLevel;
  code: string;
  message: string;
}

export interface ParsedProductionRecord {
  rowKey: string;
  campaignSource: string;
  campaignNormalized: string;
  businessUnitSource: string;
  businessUnitNormalized: string;
  reportYear: number | null;
  reportMonth: number | null;
  metricType: ProductionMetricType;
  metricUnit: string | null;
  target: number | null;
  week1: number | null;
  week2: number | null;
  week3: number | null;
  week4: number | null;
  week5: number | null;
  mtd: number | null;
  achievement: number | null;
  runRate: number | null;
  workingDays: number | null;
  daysLapse: number | null;
  dateUpdated: string | null;
  sourceSheet: string;
  sourceRow: number;
  sourceHash: string;
  issues: ProductionValidationIssue[];
}

export interface ProductionWorkbookResult {
  fileName: string;
  worksheets: Array<{
    name: string;
    supported: boolean;
    recordCount: number;
    periods: string[];
    detectedWeeks: number[];
    error?: string;
  }>;
  reportingPeriods: Array<{ year: number; month: number }>;
  detectedWeeks: number[];
  excludedFields: string[];
  records: ParsedProductionRecord[];
}

export interface ProductionRecordDto {
  id: string;
  campaignId: string;
  campaignName: string;
  businessUnitId: string;
  businessUnitName: string;
  reportYear: number;
  reportMonth: number;
  metricType: ProductionMetricType;
  metricUnit: string | null;
  target: number | null;
  week1: number | null;
  week2: number | null;
  week3: number | null;
  week4: number | null;
  week5: number | null;
  mtd: number | null;
  achievement: number | null;
  runRate: number | null;
  workingDays: number | null;
  daysLapse: number | null;
  dateUpdated: string | null;
  status: ProductionStatus;
}
