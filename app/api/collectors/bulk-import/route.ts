import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import * as XLSX from 'xlsx';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { matchMetricAlias, normalizeMetricHeader } from '@/lib/metric-import-mapping';
import { isBdoDashboardWorkbook, parseBdoDashboardWorkbook, type BdoImportRecord } from '@/lib/bdo-dashboard-import';
import { bpiImportRecordIdentity, isBpiDashboardWorkbook, parseBpiDashboardWorkbook } from '@/lib/bpi-dashboard-import';
import { mapWorksheetCampaign } from '@/lib/campaign-import-selection';
import { isMbPaMonthlyLayout, parseMbPaMonthlyRows } from '@/lib/mb-pa-import';
import { isMbGoalAchievementLayout, parseMbGoalAchievementRows } from '@/lib/mb-goal-achievement-import';
import { parseImportNumber } from '@/lib/import-number';
import { parseCampaignSummaryWorksheet } from '@/lib/campaign-summary-import';
import {
  BDO_SGM_METRIC_TYPE,
  isBdoSgmCampaign,
  parseBdoSgmPivotCache,
  parseBdoSgmWorksheet,
  type BdoSgmWorksheetParseResult,
} from '@/lib/bdo-sgm-ranking-import';
import {
  parseBdoSgmConsolidatedWorksheet,
  type BdoSgmConsolidatedAgent,
  type BdoSgmConsolidatedParseResult,
} from '@/lib/bdo-sgm-consolidated-import';
import { calculateKpiAchievements } from '@/lib/kpi-performance';
import { parseKpiWorkbook, type KpiWorkbookResult, type ParsedKpiRow } from '@/lib/kpi-workbook';
import { BDO_CCC_CAMPAIGN_PATTERN } from '@/lib/bdo-ccc-kpi';

type BdoSgmParseResult = BdoSgmWorksheetParseResult | BdoSgmConsolidatedParseResult;

type ParsedEntry = {
  name: string; count: number; volume: number;
  transmittals?: number; approvals?: number; booked?: number; activations?: number;
  transmittedVolume?: number; approvalsVolume?: number; bookedVolume?: number;
  ntb?: number; supplementary?: number; seatCategory?: string;
  agentCode?: string; agentLevel?: string; dateHired?: Date; agentType?: string;
  monthlyGoal?: number; monthlyActual?: number; monthlyAchievement?: number;
  overallGoal?: number; overallActual?: number; overallAchievement?: number;
  teamGoal?: number; elapsedWorkingDays?: number; totalWorkingDays?: number;
  metricType?: string;
  cardLevel?: string;
  cardLevelLabel?: string;
  grandTotal?: number;
  nickname?: string;
  finalTotal?: number;
  wholeYearTotal?: number;
  firstPeriodTotal?: number;
  secondPeriodTotal?: number;
  workbookGrandTotal?: number;
  ranking?: number;
  monthValues?: Array<{
    month: number;
    label: string;
    value: number;
    available: boolean;
    originalValue: string | number | null;
  }>;
  sourceSheet?: string;
  campaignId?: string;
  campaignName?: string;
  reportDate?: Date;
  validationErrors?: string[];
  normalizedMetrics?: NormalizedMetric[];
  // MB PL wide-format per-category totals (transaction + volume)
  bauPayrollTxn?: number; bauPayrollVol?: number;
  bauDepositorTxn?: number; bauDepositorVol?: number;
  topupPayrollTxn?: number; topupPayrollVol?: number;
  topupDepositorTxn?: number; topupDepositorVol?: number;
  openMarketTxn?: number; openMarketVol?: number;
  // MB PA wide-format: TOTAL (C2G / BT / BalCon PA) + GRAND TOTAL
  c2gTxn?: number; c2gVol?: number;
  btTxn?: number; btVol?: number;
  balconTxn?: number; balconVol?: number;
  grandTotalTxn?: number; grandTotalVol?: number;
  rowIdx: number;
};

type AssignedCampaign = { id: string; campaignName: string };
type WorksheetCampaignMappings = Record<string, string[]>;
type ReportPeriodType = 'daily' | 'monthly' | 'yearly';
type DuplicateMode = 'skip' | 'update' | 'replace_period';

const MB_PA_DETAIL_KEYS = [
  'c2gTxn', 'c2gVol', 'btTxn', 'btVol', 'balconTxn', 'balconVol', 'grandTotalTxn', 'grandTotalVol',
] as const;

function parseWorksheetCampaignMappings(value: FormDataEntryValue | null): WorksheetCampaignMappings {
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).map(([key, rawIds]) => {
      const ids = Array.isArray(rawIds) ? rawIds : typeof rawIds === 'string' && rawIds ? [rawIds] : [];
      return [key, [...new Set(ids.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())).map((id) => id.trim()))]];
    }));
  } catch {
    return {};
  }
}

function hasInvalidCampaignMapping(ids: string[], selectedCampaigns: AssignedCampaign[]) {
  const selectedIds = new Set(selectedCampaigns.map((campaign) => campaign.id));
  return ids.some((id) => !selectedIds.has(id));
}

type NormalizedMetric = {
  metricType: string;
  count?: number | null;
  volume?: number | null;
  goal?: number | null;
  actual?: number | null;
  achievement?: number | null;
};

function normalizePeriodDate(date: Date, periodType: ReportPeriodType) {
  if (periodType === 'monthly') return new Date(date.getFullYear(), date.getMonth(), 1);
  if (periodType === 'yearly') return new Date(date.getFullYear(), 0, 1);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function expandEntryMetrics(entry: ParsedEntry): NormalizedMetric[] {
  if (entry.normalizedMetrics?.length) return entry.normalizedMetrics;
  const metrics: NormalizedMetric[] = [];
  const countMetrics = [
    ['transmittals', entry.transmittals, entry.transmittedVolume],
    ['approvals', entry.approvals, entry.approvalsVolume],
    ['booked', entry.booked, entry.bookedVolume],
    ['activations', entry.activations, undefined],
  ] as const;
  for (const [metricType, count, metricVolume] of countMetrics) {
    if (count !== undefined || metricVolume !== undefined) metrics.push({ metricType, count: count ?? null, volume: metricVolume ?? null });
  }
  if (entry.ntb !== undefined) metrics.push({ metricType: 'ntb', count: entry.ntb });
  if (entry.supplementary !== undefined) metrics.push({ metricType: 'supplementary', count: entry.supplementary });
  if (entry.monthlyGoal !== undefined) metrics.push({ metricType: 'goal', goal: entry.monthlyGoal });
  if (entry.monthlyActual !== undefined) metrics.push({ metricType: 'actual', actual: entry.monthlyActual });
  if (entry.monthlyAchievement !== undefined) metrics.push({ metricType: 'achievement', achievement: entry.monthlyAchievement });
  if (!metrics.length) metrics.push({ metricType: entry.metricType || 'transmittals', count: entry.count, volume: entry.volume });
  if (metrics.length === 1 && metrics[0].volume == null && entry.volume) metrics[0].volume = entry.volume;
  return metrics;
}

type SheetPreview = {
  key: string;
  sheetName: string;
  hidden: boolean;
  selected: boolean;
  format: string;
  campaignId: string;
  campaignName: string;
  campaignMapping: 'sheet' | 'record' | 'selected' | 'unresolved';
  metricType: string;
  metricSource: 'sheet' | 'selected';
  reportDate: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  validAgentRows?: number;
  monthlyRecordsDetected?: number;
  skippedBlankCells?: number;
  warningCount?: number;
  detectedMonths?: string[];
  detectedMetrics?: string[];
  detectedCardLevels?: string[];
  validationIssues?: Array<{ worksheet: string; row: number; reason: string; warning: boolean }>;
  consolidatedAgents?: BdoSgmConsolidatedAgent[];
  warnings: string[];
  errors: string[];
  matched: any[];
  notFound: any[];
  entries: ParsedEntry[];
};

async function ensureImportMetadataColumns() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ProductionEntry"
      ADD COLUMN IF NOT EXISTS "importFileName" TEXT,
      ADD COLUMN IF NOT EXISTS "importMetricType" TEXT,
      ADD COLUMN IF NOT EXISTS "importWorkbookSheets" TEXT,
      ADD COLUMN IF NOT EXISTS "importAuditLog" JSONB,
      ADD COLUMN IF NOT EXISTS "reportPeriodType" TEXT NOT NULL DEFAULT 'daily';
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "DashboardImportBatch"
      ADD COLUMN IF NOT EXISTS "selectedCampaignIds" TEXT,
      ADD COLUMN IF NOT EXISTS "detectedWorksheets" TEXT,
      ADD COLUMN IF NOT EXISTS "duplicateCount" INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "unmappedCount" INTEGER NOT NULL DEFAULT 0;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "DashboardImportRecord"
      ADD COLUMN IF NOT EXISTS "dateHired" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "dataStatus" TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ProductionDetail"
      ADD COLUMN IF NOT EXISTS "transmittedVolume" BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "approvalsVolume" BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "bookedVolume" BIGINT NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "sourceSheet" TEXT,
      ADD COLUMN IF NOT EXISTS "agentCode" TEXT,
      ADD COLUMN IF NOT EXISTS "agentLevel" TEXT,
      ADD COLUMN IF NOT EXISTS "dateHired" TIMESTAMP(3),
      ADD COLUMN IF NOT EXISTS "agentType" TEXT,
      ADD COLUMN IF NOT EXISTS "monthlyGoal" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "monthlyActual" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "monthlyAchievement" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "overallGoal" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "overallActual" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "overallAchievement" DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS "cardLevel" TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "cardLevelLabel" TEXT,
      ADD COLUMN IF NOT EXISTS "cardLevelGrandTotal" BIGINT,
      ADD COLUMN IF NOT EXISTS "sourceNickname" TEXT,
      ADD COLUMN IF NOT EXISTS "cardLevelFinalTotal" BIGINT,
      ADD COLUMN IF NOT EXISTS "cardLevelFirstPeriodTotal" BIGINT,
      ADD COLUMN IF NOT EXISTS "cardLevelSecondPeriodTotal" BIGINT,
      ADD COLUMN IF NOT EXISTS "cardLevelWorkbookGrandTotal" BIGINT,
      ADD COLUMN IF NOT EXISTS "cardLevelRanking" INTEGER,
      ADD COLUMN IF NOT EXISTS "cardLevelMonthValues" JSONB;
  `);
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "ProductionMetricRecord"
      ADD COLUMN IF NOT EXISTS "cardLevel" TEXT NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS "cardLevelLabel" TEXT,
      ADD COLUMN IF NOT EXISTS "grandTotal" BIGINT,
      ADD COLUMN IF NOT EXISTS "sourceNickname" TEXT,
      ADD COLUMN IF NOT EXISTS "finalTotal" BIGINT,
      ADD COLUMN IF NOT EXISTS "firstPeriodTotal" BIGINT,
      ADD COLUMN IF NOT EXISTS "secondPeriodTotal" BIGINT,
      ADD COLUMN IF NOT EXISTS "workbookGrandTotal" BIGINT,
      ADD COLUMN IF NOT EXISTS "ranking" INTEGER,
      ADD COLUMN IF NOT EXISTS "monthValues" JSONB;
  `);
  await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "ProductionMetricRecord_campaignId_agentId_metricType_reportPeriodType_reportDate_key"');
  await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "ProductionMetricRecord_campaignId_agentId_metricType_reportDate_key"');
  await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "ProductionMetricRecord_campaignId_agentId_metricType_reportDate"');
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "ProductionMetricRecord_campaignId_agentId_metricType_reportPeriodType_reportDate_cardLevel_key" ON "ProductionMetricRecord"("campaignId", "agentId", "metricType", "reportPeriodType", "reportDate", "cardLevel")');
  await prisma.$executeRawUnsafe('DROP INDEX IF EXISTS "ProductionDetail_productionEntryId_agentId_key"');
  await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "ProductionDetail_productionEntryId_agentId_cardLevel_key" ON "ProductionDetail"("productionEntryId", "agentId", "cardLevel")');
}

async function saveImportMetadata(entryId: string, fileName: string, metricType: string, sheetNames?: string[], auditLog?: any, db: any = prisma) {
  await db.$executeRaw`
    UPDATE "ProductionEntry"
    SET "importFileName" = ${fileName},
        "importMetricType" = ${metricType},
        "importWorkbookSheets" = ${sheetNames?.join(', ') || null},
        "importAuditLog" = ${auditLog ? JSON.stringify(auditLog) : null}::jsonb
    WHERE id = ${entryId}
  `;
}

function selectedImportPeriod(row: any) {
  const auditLog = row.importAuditLog && typeof row.importAuditLog === 'object'
    ? row.importAuditLog
    : null;
  const selectedReportDate = typeof auditLog?.selectedReportDate === 'string'
    && /^\d{4}-\d{2}-\d{2}$/.test(auditLog.selectedReportDate)
    ? auditLog.selectedReportDate
    : null;

  if (!selectedReportDate) {
    return {
      reportDate: row.date,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
    };
  }

  const [year, month] = selectedReportDate.split('-').map(Number);
  const atBusinessMidnight = (value: string) => `${value}T00:00:00.000+08:00`;

  if (row.reportPeriodType === 'monthly') {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return {
      reportDate: atBusinessMidnight(`${year}-${String(month).padStart(2, '0')}-01`),
      periodStart: atBusinessMidnight(`${year}-${String(month).padStart(2, '0')}-01`),
      periodEnd: atBusinessMidnight(`${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`),
    };
  }

  if (row.reportPeriodType === 'yearly') {
    return {
      reportDate: atBusinessMidnight(`${year}-01-01`),
      periodStart: atBusinessMidnight(`${year}-01-01`),
      periodEnd: atBusinessMidnight(`${year}-12-31`),
    };
  }

  return {
    reportDate: atBusinessMidnight(selectedReportDate),
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
  };
}

function formatImportSummary(row: any) {
  const selectedPeriod = selectedImportPeriod(row);
  return {
    id: row.id,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    fileName: row.importFileName || 'Imported production data',
    metricType: row.importMetricType || 'unknown',
    reportDate: selectedPeriod.reportDate,
    periodStart: selectedPeriod.periodStart,
    periodEnd: selectedPeriod.periodEnd,
    importedAt: row.createdAt,
    entryTime: row.time,
    detailCount: Number(row.detailCount || 0),
    totals: {
      transmittals: Number(row.transmittals || 0),
      approvals: Number(row.approvals || 0),
      booked: Number(row.booked || 0),
      volume: Number(row.volume || 0),
      ntb: Number(row.ntb || 0),
      supplementary: Number(row.supplementary || 0),
    },
  };
}

async function getImportSummary(entryId: string, collectorId: string) {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT pe.id,
           pe."campaignId",
           c."campaignName",
           pe.date,
           pe.time,
           pe."periodStart",
           pe."periodEnd",
           pe."reportPeriodType",
           pe."importAuditLog",
           pe."createdAt",
           pe."importFileName",
           pe."importMetricType",
           COUNT(pd.id) AS "detailCount",
           COALESCE(SUM(pd.transmittals), 0) AS transmittals,
           COALESCE(SUM(pd.approvals), 0) AS approvals,
           COALESCE(SUM(pd.booked), 0) AS booked,
           COALESCE(SUM(pd.volume), 0) AS volume,
           COALESCE(SUM(pd.ntb), 0) AS ntb,
           COALESCE(SUM(pd.supplementary), 0) AS supplementary
    FROM "ProductionEntry" pe
    JOIN "Campaign" c ON c.id = pe."campaignId"
    LEFT JOIN "ProductionDetail" pd ON pd."productionEntryId" = pe.id
    WHERE pe.id = ${entryId}
      AND pe."createdBy" = ${collectorId}
    GROUP BY pe.id, c."campaignName"
    LIMIT 1
  `;

  return rows[0] ? formatImportSummary(rows[0]) : null;
}

// Parse BPI PA / ACQ raw Excel rows. Supports three layouts:
//   1. Simple template: FULL NAME | COUNT/metric | VOLUME
//   2. BPI wide report:  AGENT CODE | LAST NAME | FIRST NAME | repeating TRANSACTION/VOLUME pairs
//      (per category: BAU Payroll, Depositor, Top Up, Open Market, …)
//   3. ACQ report:       AGENT CODE | LAST NAME | FIRST NAME | DATE ONBOARD | SEAT CATEGORY |
//      TOTAL + repeating NTB/SUPPLEMENTARY pairs per date
function parseExcelRows(rows: any[], metricType: string, campaignName = ''): ParsedEntry[] {
  const isMbPa = /\bmb\s*pa\b/i.test(campaignName);
  let nameCol  = 1;
  let countCol = 3;
  let volumeCol = 4;
  let transmittalsCol = -1;
  let approvalsCol = -1;
  let bookedCol = -1;
  let activationsCol = -1;

  // Wide/ACQ-format markers
  let lastNameCol = -1;
  let firstNameCol = -1;
  let seatCategoryCol = -1;
  const transactionCols: number[] = [];
  const volumeCols: number[] = [];
  const ntbCols: number[] = [];
  const suppleCols: number[] = [];

  // Headers can span several rows (labels like TRANSACTION/VOLUME/NTB sit on a lower row)
  for (let i = 0; i < Math.min(6, rows.length); i++) {
    const row = rows[i] || [];
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] || '').toLowerCase().trim();
      if (!cell) continue;
      if (cell.includes('full name')) nameCol = j;
      if (cell.includes('last name')) lastNameCol = j;
      if (cell.includes('first name')) firstNameCol = j;
      if (cell.includes('seat cat')) seatCategoryCol = j;
      if (cell === 'count') countCol = j;
      if (cell === 'volume') { volumeCol = j; if (!volumeCols.includes(j)) volumeCols.push(j); }
      if (cell === 'transaction' && !transactionCols.includes(j)) transactionCols.push(j);
      if (cell === 'ntb' && !ntbCols.includes(j)) ntbCols.push(j);
      if (cell.includes('supple') && !suppleCols.includes(j)) suppleCols.push(j);
      if (cell === 'transmitted') transmittalsCol = j;
      if (cell === 'approvals') approvalsCol = j;
      if (cell === 'booked') bookedCol = j;
      if (cell === 'activation' || cell === 'activations' || cell === 'activated') activationsCol = j;
    }
  }

  // ─── ACQ FORMAT ─────────────────────────────────────────────────────────────
  // Name from LAST + FIRST; detect SEAT CATEGORY and take the HIGHEST NTB and
  // HIGHEST SUPPLEMENTARY across all columns (the TOTAL column is the max).
  if (lastNameCol >= 0 && firstNameCol >= 0 && ntbCols.length > 0) {
    ntbCols.sort((a, b) => a - b);
    suppleCols.sort((a, b) => a - b);

    let dataStartRow = -1;
    for (let i = 0; i < rows.length; i++) {
      const v = String(rows[i]?.[lastNameCol] || '').trim().toLowerCase();
      if (v && v !== 'last name') { dataStartRow = i; break; }
    }
    if (dataStartRow < 0) return [];

    const entries: ParsedEntry[] = [];
    for (let i = dataStartRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const last = String(row[lastNameCol] || '').trim();
      const first = String(row[firstNameCol] || '').trim();
      if (!last || !first) continue; // skips the TOTAL row and any blank rows
      const name = `${last}, ${first}`.toUpperCase();
      const seatCategory = seatCategoryCol >= 0 ? String(row[seatCategoryCol] || '').trim() : '';

      let ntb = 0;
      for (const c of ntbCols) ntb = Math.max(ntb, Math.floor(Number(row[c]) || 0));
      let supplementary = 0;
      for (const c of suppleCols) supplementary = Math.max(supplementary, Math.floor(Number(row[c]) || 0));

      entries.push({ name, count: ntb, volume: 0, ntb, supplementary, seatCategory, rowIdx: i + 1 });
    }
    return entries;
  }

  // ─── WIDE FORMAT ────────────────────────────────────────────────────────────
  // Name comes from LAST NAME + FIRST NAME; per the report each agent has many
  // TRANSACTION/VOLUME pairs across categories, so we take the HIGHEST of each.
  if (lastNameCol >= 0 && firstNameCol >= 0 && transactionCols.length > 0) {
    transactionCols.sort((a, b) => a - b);
    volumeCols.sort((a, b) => a - b);

    // First data row = first row with a real last name (not the header word)
    let dataStartRow = -1;
    for (let i = 0; i < rows.length; i++) {
      const v = String(rows[i]?.[lastNameCol] || '').trim().toLowerCase();
      if (v && v !== 'last name') { dataStartRow = i; break; }
    }
    if (dataStartRow < 0) return [];

    const entries: ParsedEntry[] = [];
    for (let i = dataStartRow; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;
      const last = String(row[lastNameCol] || '').trim();
      const first = String(row[firstNameCol] || '').trim();
      if (!last || !first) continue; // skips the TOTAL row and any blank rows
      const name = `${last}, ${first}`.toUpperCase();

      let maxTx = 0;
      for (const c of transactionCols) maxTx = Math.max(maxTx, Math.floor(Number(row[c]) || 0));
      let maxVol = 0;
      for (const c of volumeCols) maxVol = Math.max(maxVol, Math.round(Number(row[c]) || 0));

      const txn = (i2: number) => { const c = transactionCols[i2]; return c !== undefined ? Math.max(0, Math.floor(Number(row[c]) || 0)) : 0; };
      const vol = (i2: number) => { const c = volumeCols[i2]; return c !== undefined ? Math.max(0, Math.round(Number(row[c]) || 0)) : 0; };
      // MB PA: first pairs are TOTAL(C2G, BT, BalCon PA) then GRAND TOTAL.
      // MB PL / BPI: first five pairs are BAU Payroll/Depositor, Top Up Payroll/Depositor, Open Market.
      const categories = isMbPa
        ? {
            c2gTxn: txn(0), c2gVol: vol(0),
            btTxn: txn(1), btVol: vol(1),
            balconTxn: txn(2), balconVol: vol(2),
            // Grand Total = sum of the three categories (the file's own grand-total
            // column isn't reliably positioned, so we derive it).
            grandTotalTxn: txn(0) + txn(1) + txn(2),
            grandTotalVol: vol(0) + vol(1) + vol(2),
          }
        : {
            bauPayrollTxn: txn(0), bauPayrollVol: vol(0),
            bauDepositorTxn: txn(1), bauDepositorVol: vol(1),
            topupPayrollTxn: txn(2), topupPayrollVol: vol(2),
            topupDepositorTxn: txn(3), topupDepositorVol: vol(3),
            openMarketTxn: txn(4), openMarketVol: vol(4),
          };

      if (metricType === 'all_metrics') {
        entries.push({ name, count: maxTx, volume: maxVol, transmittals: maxTx, approvals: 0, booked: 0, ...categories, rowIdx: i + 1 });
      } else {
        entries.push({ name, count: maxTx, volume: maxVol, ...categories, rowIdx: i + 1 });
      }
    }
    return entries;
  }

  // ─── SIMPLE TEMPLATE ────────────────────────────────────────────────────────
  // First data row = first row where col 0 is a number
  let dataStartRow = 2;
  for (let i = 0; i < rows.length; i++) {
    if (typeof rows[i][0] === 'number') {
      dataStartRow = i;
      break;
    }
  }

  const entries: ParsedEntry[] = [];
  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const agentName = row[nameCol];
    if (!agentName || !String(agentName).trim()) continue;
    if (row[0] !== null && row[0] !== undefined && typeof row[0] !== 'number') continue;

    const volume = Math.max(0, Math.round(Number(row[volumeCol]) || 0));

    if (metricType === 'all_metrics') {
      // Try to read all three metrics from separate columns
      let transmittals = transmittalsCol >= 0 ? Math.max(0, Math.floor(Number(row[transmittalsCol]) || 0)) : 0;
      let approvals = approvalsCol >= 0 ? Math.max(0, Math.floor(Number(row[approvalsCol]) || 0)) : 0;
      let booked = bookedCol >= 0 ? Math.max(0, Math.floor(Number(row[bookedCol]) || 0)) : 0;
      let activations = activationsCol >= 0 ? Math.max(0, Math.floor(Number(row[activationsCol]) || 0)) : 0;

      // Fallback: if individual metric columns not found but COUNT column exists, use COUNT for transmittals
      if (transmittalsCol < 0 && approvalsCol < 0 && bookedCol < 0 && activationsCol < 0 && countCol >= 0) {
        transmittals = Math.max(0, Math.floor(Number(row[countCol]) || 0));
      }

      entries.push({
        name: String(agentName).trim(), count: transmittals, volume,
        transmittals: transmittalsCol >= 0 || (transmittalsCol < 0 && approvalsCol < 0 && bookedCol < 0 && activationsCol < 0) ? transmittals : undefined,
        approvals: approvalsCol >= 0 ? approvals : undefined,
        booked: bookedCol >= 0 ? booked : undefined,
        activations: activationsCol >= 0 ? activations : undefined,
        rowIdx: i + 1,
      });
    } else {
      // Single COUNT column
      const count = Math.max(0, Math.floor(Number(row[countCol]) || 0));
      entries.push({ name: String(agentName).trim(), count, volume, rowIdx: i + 1 });
    }
  }
  return entries;
}

function nameToEmail(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${slug}-${Date.now()}@imported.local`;
}

function normalizeAgentName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function agentNameMatches(savedName: string, importedName: string): boolean {
  const saved = normalizeAgentName(savedName);
  const imported = normalizeAgentName(importedName);
  if (!saved || !imported) return false;
  if (saved === imported || saved.includes(imported) || imported.includes(saved)) return true;
  const importedTokens = imported.split(' ').filter((token) => token.length > 1);
  return importedTokens.length > 0 && importedTokens.every((token) => saved.includes(token));
}

function normalizeHeader(value: any): string {
  return normalizeMetricHeader(String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''));
}

function cellText(value: any): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function parseNumberSafe(value: any): { value: number; error?: string } {
  {
    const imported = parseImportNumber(value);
    if (!imported.valid) return { value: 0, error: `Invalid number "${String(value).slice(0, 30)}"` };
    if (imported.value == null) return { value: 0 };
    if (imported.value < 0) return { value: 0, error: 'Negative values are not allowed' };
    return { value: imported.percentage ? imported.value / 100 : imported.value };
  }
  if (value == null || value === '') return { value: 0 };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { value: 0, error: 'Invalid number' };
    if (value < 0) return { value: 0, error: 'Negative values are not allowed' };
    return { value };
  }
  if (/^(?:-|n\/?a|none|null)$/i.test(String(value).trim())) return { value: 0 };
  const cleaned = String(value).replace(/[₱,$\s]/g, '').replace(/[()]/g, '-').trim();
  if (!cleaned) return { value: 0 };
  const parsed = Number(cleaned.replace(/%$/, '')) / (cleaned.endsWith('%') ? 100 : 1);
  if (!Number.isFinite(parsed)) return { value: 0, error: `Invalid number "${String(value).slice(0, 30)}"` };
  if (parsed < 0) return { value: 0, error: 'Negative values are not allowed' };
  return { value: parsed };
}

function isFooterOrBlankName(value: string) {
  const normalized = normalizeHeader(value);
  return !normalized || ['total', 'grand total', 'subtotal', 'summary', 'overall'].some((word) => normalized === word || normalized.startsWith(`${word} `));
}

function findHeaderAlias(rows: any[][], aliases: string[], maxRows = 20): { row: number; col: number } | null {
  const normalizedAliases = aliases.map(normalizeHeader);
  // Alias order is the deterministic priority; exact matches always win.
  for (const alias of normalizedAliases) {
    for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (normalizeHeader(row[c]) === alias) return { row: r, col: c };
      }
    }
  }
  for (const alias of normalizedAliases) {
    for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
      const row = rows[r] || [];
      for (let c = 0; c < row.length; c++) {
        const value = normalizeHeader(row[c]);
        if (value.includes(alias)) return { row: r, col: c };
      }
    }
  }
  return null;
}

function detectMetricFromText(text: string, fallback: string) {
  const alias = matchMetricAlias(text);
  if (alias === 'approvals' || alias === 'booked' || alias === 'transmittals' || alias === 'activations') return alias;
  const normalized = normalizeHeader(text);
  if (/\bntb\b|\bsupplementary\b|\bacq\b/.test(normalized)) return 'acq';
  if (/\ball metrics\b/.test(normalized)) return 'all_metrics';
  return fallback;
}

function parseReportDateFromRows(rows: any[][], fallback: Date, context = ''): Date {
  const min = new Date(2020, 0, 1).getTime();
  const max = new Date(2035, 11, 31).getTime();
  const contextualDate = parseDetectedDate(context, fallback);
  if (contextualDate && contextualDate.getTime() >= min && contextualDate.getTime() <= max) return contextualDate;
  for (const row of rows.slice(0, 20)) {
    for (const cell of row || []) {
      const candidate = parseDetectedDate(cell, fallback);
      if (candidate && candidate.getTime() >= min && candidate.getTime() <= max) {
        return new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate());
      }
    }
  }
  return fallback;
}

function ymd(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rowHasAnyValue(row: any[]) {
  return (row || []).some((cell) => cell != null && String(cell).trim() !== '');
}

const MONTH_INDEX = new Map([
  ['january', 0], ['february', 1], ['march', 2], ['april', 3], ['may', 4], ['june', 5],
  ['july', 6], ['august', 7], ['september', 8], ['october', 9], ['november', 10], ['december', 11],
  ['jan', 0], ['feb', 1], ['mar', 2], ['apr', 3], ['jun', 5], ['jul', 6], ['aug', 7],
  ['sep', 8], ['sept', 8], ['oct', 9], ['nov', 10], ['dec', 11],
]);

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function monthIndexFromText(value: any): number | undefined {
  const text = normalizeHeader(value);
  if (!text) return undefined;
  for (const token of text.split(/\s+/)) {
    const month = MONTH_INDEX.get(token);
    if (month !== undefined) return month;
  }
  return undefined;
}

function yearFromText(value: any): number | undefined {
  const match = cellText(value).match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function parseCellDate(value: any): Date | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && value > 30000 && value < 60000) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return undefined;
}

function parseDetectedDate(value: any, fallback: Date): Date | undefined {
  if (value == null || value === '') return undefined;
  const month = monthIndexFromText(value);
  if (month !== undefined) return new Date(yearFromText(value) || fallback.getFullYear(), month, 1);
  const parsed = parseCellDate(value);
  return parsed ? new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) : undefined;
}

function findDateHeader(rows: any[][], maxRows = 30): { row: number; col: number } | null {
  const aliases = new Set(['date', 'report date', 'reporting date', 'month', 'report month', 'reporting month', 'period', 'reporting period']);
  for (let r = 0; r < Math.min(rows.length, maxRows); r++) {
    for (let c = 0; c < (rows[r] || []).length; c++) {
      if (aliases.has(normalizeHeader(rows[r][c]))) return { row: r, col: c };
    }
  }
  return null;
}

function detectedSectionDate(row: any[], fallback: Date): Date | undefined {
  const populated = (row || []).filter((cell) => cell != null && cellText(cell) !== '');
  if (!populated.length || populated.length > 3) return undefined;
  const combined = populated.map(cellText).join(' ');
  return monthIndexFromText(combined) !== undefined ? parseDetectedDate(combined, fallback) : undefined;
}

function detectDatesByRow(rows: any[][], fallback: Date, dateCol?: number) {
  const dates = new Map<number, Date>();
  let activeDate = fallback;
  for (let r = 0; r < rows.length; r++) {
    const sectionDate = detectedSectionDate(rows[r] || [], activeDate);
    if (sectionDate) {
      activeDate = sectionDate;
      continue;
    }
    dates.set(r + 1, dateCol === undefined ? activeDate : parseDetectedDate(rows[r]?.[dateCol], activeDate) || activeDate);
  }
  return dates;
}

// Dashboard workbooks use merged month/metric headers. Build a logical header
// for every column by carrying the last month and parent metric to child columns.
function parseMonthlyAgentRows(rows: any[][], sheetName: string, campaignName: string, fallbackDate: Date) {
  const mbPa = parseMbPaMonthlyRows(rows, fallbackDate);
  if (mbPa?.entries.length) {
    return {
      format: 'MB PA Monthly Dashboard',
      entries: mbPa.entries.map((entry) => ({
        ...entry,
        sourceSheet: sheetName,
        campaignName,
        metricType: 'all_metrics',
      })),
      invalidRows: mbPa.invalidRows,
      warnings: mbPa.warnings,
      errors: [] as string[],
    };
  }

  const mbGoalAchievement = /^mb\b/i.test(campaignName.trim())
    ? parseMbGoalAchievementRows(rows, fallbackDate)
    : null;
  if (mbGoalAchievement?.entries.length) {
    return {
      format: 'MB Monthly Goal & Achievement',
      entries: mbGoalAchievement.entries.map((entry) => ({
        ...entry,
        sourceSheet: sheetName,
        campaignName,
        metricType: 'all_metrics',
      })),
      invalidRows: mbGoalAchievement.invalidRows,
      warnings: mbGoalAchievement.warnings,
      errors: [] as string[],
    };
  }

  const monthHits: Array<{ row: number; col: number; month: number; year?: number }> = [];
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    for (let c = 0; c < (rows[r] || []).length; c++) {
      const value = rows[r][c];
      const month = monthIndexFromText(value);
      if (month !== undefined) monthHits.push({ row: r, col: c, month, year: yearFromText(value) });
    }
  }
  if (!monthHits.length) return null;

  let headerRow = -1;
  let nameCol = -1;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = (rows[r] || []).map(normalizeHeader);
    const candidate = cells.findIndex((value) => ['agent', 'agent name', 'agent fullname', 'name', 'full name'].includes(value));
    if (candidate >= 0) { headerRow = r; nameCol = candidate; break; }
  }
  if (headerRow < 0 || nameCol < 0) return null;

  let dataStartRow = -1;
  for (let r = headerRow + 1; r < rows.length; r++) {
    const value = cellText(rows[r]?.[nameCol]);
    if (value && !['agent', 'agent name', 'agent fullname', 'name', 'full name'].includes(normalizeHeader(value))) { dataStartRow = r; break; }
  }
  if (dataStartRow < 0) return null;
  const lastHeaderRow = dataStartRow - 1;
  const headerMonthHits = monthHits.filter((hit) => hit.row <= lastHeaderRow);
  if (!headerMonthHits.length) return null;
  const maxCols = Math.max(0, ...rows.slice(0, lastHeaderRow + 1).map((row) => row.length));
  const sortedMonths = headerMonthHits.sort((a, b) => a.col - b.col || a.row - b.row);
  const columns: Array<{ col: number; month: number; metric?: string; field: string }> = [];
  let currentMetric = '';
  for (let c = 0; c < maxCols; c++) {
    const monthHit = [...sortedMonths].reverse().find((hit) => hit.col <= c);
    if (!monthHit || c === nameCol) continue;
    const labels = rows.slice(0, lastHeaderRow + 1).map((row) => normalizeHeader(row[c])).filter(Boolean);
    const text = labels.join(' ');
    const parent = /transmitted|transmittal/.test(text) ? 'transmittals' : /approval/.test(text) ? 'approvals' : /booked|booking/.test(text) ? 'booked' : /activation|activated/.test(text) ? 'activations' : '';
    if (parent) currentMetric = parent;
    const field = /achievement|achieve/.test(text) ? 'achievement'
      : /actual/.test(text) ? 'actual'
      : /goal|target/.test(text) ? 'goal'
      : /volume|amount/.test(text) ? 'volume'
      : /count|transaction/.test(text) ? 'count' : '';
    if (field) columns.push({ col: c, month: monthHit.month, metric: parent || currentMetric || undefined, field });
  }
  if (!columns.length) return null;

  const explicitYear = rows.slice(0, dataStartRow).flat().map(cellText).find((value) => /^20\d{2}$/.test(value));
  const year = Number(explicitYear) || fallbackDate.getFullYear();
  const levelHit = findHeaderAlias(rows, ['level'], 30);
  const dateHiredHit = findHeaderAlias(rows, ['date hired', 'date onboard'], 30);
  const typeHit = findHeaderAlias(rows, ['type', 'status'], 30);
  const entries: ParsedEntry[] = [];
  let invalidRows = 0;
  const warnings: string[] = [];

  for (let r = dataStartRow; r < rows.length; r++) {
    const row = rows[r] || [];
    const name = cellText(row[nameCol]);
    if (!name || isFooterOrBlankName(name) || /rank|average/i.test(name)) continue;
    for (const month of [...new Set(columns.map((column) => column.month))].sort((a, b) => a - b)) {
      const values = columns.filter((column) => column.month === month);
      const hasMetric = (metric: string) => values.some((item) => item.metric === metric);
      const get = (field: string, metric?: string) => {
        const column = values.find((item) => item.field === field && (!metric || item.metric === metric));
        return column ? parseNumberSafe(row[column.col]) : { value: 0 };
      };
      const parsed = values.map((column) => parseNumberSafe(row[column.col]));
      const errors = parsed.flatMap((item) => item.error ? [item.error] : []);
      if (errors.length) { invalidRows++; warnings.push(`Row ${r + 1}: ${errors.join(', ')}`); continue; }
      const txCount = get('count', 'transmittals').value;
      const approvalCount = get('count', 'approvals').value;
      const bookedCount = get('count', 'booked').value;
      const activationCount = get('count', 'activations').value;
      const txVolume = get('volume', 'transmittals').value;
      const approvalVolume = get('volume', 'approvals').value;
      const bookedVolume = get('volume', 'booked').value;
      const actual = get('actual').value;
      if (![txCount, approvalCount, bookedCount, activationCount, txVolume, approvalVolume, bookedVolume, actual, get('goal').value].some((value) => value !== 0)) continue;
      entries.push({
        name, rowIdx: r + 1, sourceSheet: sheetName, campaignName,
        reportDate: new Date([...sortedMonths].reverse().find((hit) => hit.month === month)?.year || year, month, 1), metricType: 'all_metrics',
        count: Math.floor(txCount), volume: Math.round(actual || txVolume || approvalVolume || bookedVolume),
        transmittals: hasMetric('transmittals') ? Math.floor(txCount) : undefined,
        approvals: hasMetric('approvals') ? Math.floor(approvalCount) : undefined,
        booked: hasMetric('booked') ? Math.floor(bookedCount) : undefined,
        activations: hasMetric('activations') ? Math.floor(activationCount) : undefined,
        transmittedVolume: hasMetric('transmittals') ? Math.round(txVolume) : undefined,
        approvalsVolume: hasMetric('approvals') ? Math.round(approvalVolume) : undefined,
        bookedVolume: hasMetric('booked') ? Math.round(bookedVolume) : undefined,
        agentLevel: levelHit ? cellText(row[levelHit.col]) : undefined,
        dateHired: dateHiredHit ? parseCellDate(row[dateHiredHit.col]) : undefined,
        agentType: typeHit ? cellText(row[typeHit.col]) : undefined,
        monthlyGoal: get('goal').value, monthlyActual: actual, monthlyAchievement: get('achievement').value,
      });
    }
  }
  return { format: 'Monthly Dashboard', entries, invalidRows, warnings, errors: [] as string[] };
}

function parseDetectedRows(rows: any[][], metricType: string, campaignName: string, sheetName: string, reportDate: Date): {
  format: string;
  entries: ParsedEntry[];
  invalidRows: number;
  warnings: string[];
  errors: string[];
} {
  const monthly = parseMonthlyAgentRows(rows, sheetName, campaignName, reportDate);
  if (monthly?.entries.length) return monthly;
  const warnings: string[] = [];
  const errors: string[] = [];
  const nameHit = findHeaderAlias(rows, ['agent name', 'employee name', 'collector name', 'user name', 'full name']);
  const lastHit = findHeaderAlias(rows, ['last name']);
  const firstHit = findHeaderAlias(rows, ['first name']);
  const countHit = findHeaderAlias(rows, ['count']);
  const volumeHit = findHeaderAlias(rows, ['mtd production', 'total mtd', 'mtd', 'actual production', 'collected amount', 'total collection', 'amount collected', 'production', 'volume', 'total volume']);
  const transmittedHit = findHeaderAlias(rows, ['transmitted', 'transmittals', 'transmittal']);
  const approvalsHit = findHeaderAlias(rows, ['approval', 'approvals']);
  const bookedHit = findHeaderAlias(rows, ['booked', 'booking']);
  const activationsHit = findHeaderAlias(rows, ['activation', 'activations', 'activated']);
  const transmittedCountHit = findHeaderAlias(rows, ['transmitted count', 'transmittal count']);
  const approvalCountHit = findHeaderAlias(rows, ['approval count', 'approved count']);
  const bookedCountHit = findHeaderAlias(rows, ['booked count', 'booking count']);
  const activationCountHit = findHeaderAlias(rows, ['activation count', 'activated count']);
  const transmittedVolumeHit = findHeaderAlias(rows, ['transmitted volume', 'transmittal volume']);
  const approvalVolumeHit = findHeaderAlias(rows, ['approval volume', 'approved volume']);
  const bookedVolumeHit = findHeaderAlias(rows, ['booked volume', 'booking volume']);
  const teamGoalHit = findHeaderAlias(rows, ['team goal', 'campaign goal', 'monthly goal', 'campaign target', 'team target']);
  const goalCandidate = findHeaderAlias(rows, ['agent goal', 'individual goal', 'agent target', 'individual target', 'personal goal', 'monthly agent goal', 'goal', 'target']);
  const goalHit = goalCandidate && teamGoalHit && goalCandidate.row === teamGoalHit.row && goalCandidate.col === teamGoalHit.col ? null : goalCandidate;
  const actualHit = findHeaderAlias(rows, ['mtd production', 'total mtd', 'mtd', 'actual production', 'actual', 'collected amount', 'total collection', 'amount collected', 'performance', 'production']);
  const achievementHit = findHeaderAlias(rows, ['achievement', 'attainment']);
  const ntbHit = findHeaderAlias(rows, ['ntb']);
  const suppHit = findHeaderAlias(rows, ['supplementary', 'supplemental']);
  const dateHit = findDateHeader(rows);
  const agentCodeHit = findHeaderAlias(rows, ['employee id', 'agent id', 'collector id', 'agent code']);
  const elapsedWorkingDaysHit = findHeaderAlias(rows, ['elapsed working days', 'working days elapsed', 'days passed']);
  const totalWorkingDaysHit = findHeaderAlias(rows, ['total working days', 'business days', 'workdays']);

  const isAcq = Boolean(agentCodeHit && lastHit && firstHit && (ntbHit || suppHit));
  const isAllMetrics = Boolean(nameHit && (transmittedHit || approvalsHit || bookedHit || activationsHit || goalHit || actualHit || achievementHit || ntbHit || suppHit));
  const isSingleMetric = Boolean(nameHit && (countHit || volumeHit || transmittedHit || approvalsHit || bookedHit || activationsHit || goalHit || actualHit || achievementHit || ntbHit || suppHit));

  if (!isAcq && !isAllMetrics && !isSingleMetric) {
    return { format: 'Unsupported', entries: [], invalidRows: 0, warnings, errors: ['Supported headers were not found.'] };
  }

  if (isAcq || (lastHit && firstHit && (ntbHit || suppHit))) {
    const datesByRow = detectDatesByRow(rows, reportDate, dateHit?.col);
    const parsed = parseExcelRows(rows, 'acq', campaignName);
    const entries = parsed
      .filter((entry) => !isFooterOrBlankName(entry.name))
      .map((entry) => ({ ...entry, metricType: 'acq', sourceSheet: sheetName, campaignName, reportDate: datesByRow.get(entry.rowIdx) || reportDate }));
    return { format: 'ACQ', entries, invalidRows: Math.max(0, parsed.length - entries.length), warnings, errors };
  }

  const headerRow = Math.max(nameHit?.row ?? 0, countHit?.row ?? 0, transmittedHit?.row ?? 0, approvalsHit?.row ?? 0, bookedHit?.row ?? 0, activationsHit?.row ?? 0, goalHit?.row ?? 0, teamGoalHit?.row ?? 0, actualHit?.row ?? 0, achievementHit?.row ?? 0, ntbHit?.row ?? 0, suppHit?.row ?? 0, volumeHit?.row ?? 0, dateHit?.row ?? 0, elapsedWorkingDaysHit?.row ?? 0, totalWorkingDaysHit?.row ?? 0);
  const nameCol = nameHit?.col ?? 1;
  const metric = isAllMetrics ? 'all_metrics' : detectMetricFromText(`${sheetName} ${(rows[headerRow] || []).join(' ')}`, metricType);
  const entries: ParsedEntry[] = [];
  let invalidRows = 0;
  const seenHeaderRows = new Set<string>();
  let activeSectionDate = reportDate;

  for (let i = headerRow + 1; i < rows.length; i++) {
    const row = rows[i] || [];
    if (!rowHasAnyValue(row)) continue;
    const sectionDate = detectedSectionDate(row, activeSectionDate);
    if (sectionDate) {
      activeSectionDate = sectionDate;
      continue;
    }
    const normalizedRow = row.map(normalizeHeader).join('|');
    if (seenHeaderRows.has(normalizedRow) || normalizedRow.includes('full name') || normalizedRow.includes('agent name')) {
      seenHeaderRows.add(normalizedRow);
      continue;
    }
    const rawName = cellText(row[nameCol]);
    if (isFooterOrBlankName(rawName)) continue;

    const rowErrors: string[] = [];
    const volume = parseNumberSafe(row[volumeHit?.col ?? 4]);
    if (volume.error) rowErrors.push(volume.error);
    const count = parseNumberSafe(row[countHit?.col ?? transmittedHit?.col ?? approvalsHit?.col ?? bookedHit?.col ?? activationsHit?.col ?? 3]);
    if (count.error) rowErrors.push(count.error);
    const transmittals = parseNumberSafe(row[transmittedCountHit?.col ?? transmittedHit?.col ?? -1]);
    const approvals = parseNumberSafe(row[approvalCountHit?.col ?? approvalsHit?.col ?? -1]);
    const booked = parseNumberSafe(row[bookedCountHit?.col ?? bookedHit?.col ?? -1]);
    const activations = parseNumberSafe(row[activationCountHit?.col ?? activationsHit?.col ?? -1]);
    const transmittedVolume = parseNumberSafe(row[transmittedVolumeHit?.col ?? -1]);
    const approvalVolume = parseNumberSafe(row[approvalVolumeHit?.col ?? -1]);
    const bookedVolume = parseNumberSafe(row[bookedVolumeHit?.col ?? -1]);
    const goal = parseNumberSafe(row[goalHit?.col ?? -1]);
    const teamGoal = parseNumberSafe(row[teamGoalHit?.col ?? -1]);
    const actual = parseNumberSafe(row[actualHit?.col ?? -1]);
    const achievement = parseNumberSafe(row[achievementHit?.col ?? -1]);
    const ntb = parseNumberSafe(row[ntbHit?.col ?? -1]);
    const supplementary = parseNumberSafe(row[suppHit?.col ?? -1]);
    const elapsedWorkingDays = parseNumberSafe(row[elapsedWorkingDaysHit?.col ?? -1]);
    const totalWorkingDays = parseNumberSafe(row[totalWorkingDaysHit?.col ?? -1]);
    for (const parsed of [transmittals, approvals, booked, activations, transmittedVolume, approvalVolume, bookedVolume, goal, teamGoal, actual, achievement, ntb, supplementary, elapsedWorkingDays, totalWorkingDays]) if (parsed.error) rowErrors.push(parsed.error);

    if (rowErrors.length > 0) {
      invalidRows++;
      warnings.push(`Row ${i + 1}: ${rowErrors.join(', ')}`);
      continue;
    }

    const detectedRowDate = dateHit ? parseDetectedDate(row[dateHit.col], activeSectionDate) : undefined;
    entries.push({
      name: rawName,
      agentCode: agentCodeHit ? cellText(row[agentCodeHit.col]) || undefined : undefined,
      count: Math.floor(metric === 'approvals' ? approvals.value || count.value : metric === 'booked' ? booked.value || count.value : transmittals.value || count.value),
      volume: Math.round(volume.value),
      transmittals: isAllMetrics && transmittedHit ? Math.floor(transmittals.value) : undefined,
      approvals: isAllMetrics && approvalsHit ? Math.floor(approvals.value) : undefined,
      booked: isAllMetrics && bookedHit ? Math.floor(booked.value) : undefined,
      activations: isAllMetrics && activationsHit ? Math.floor(activations.value) : undefined,
      transmittedVolume: transmittedVolumeHit ? Math.round(transmittedVolume.value) : undefined,
      approvalsVolume: approvalVolumeHit ? Math.round(approvalVolume.value) : undefined,
      bookedVolume: bookedVolumeHit ? Math.round(bookedVolume.value) : undefined,
      ntb: ntbHit ? Math.floor(ntb.value) : undefined,
      supplementary: suppHit ? Math.floor(supplementary.value) : undefined,
      monthlyGoal: goalHit ? goal.value : undefined,
      teamGoal: teamGoalHit ? teamGoal.value : undefined,
      monthlyActual: actualHit ? actual.value : undefined,
      monthlyAchievement: achievementHit ? achievement.value : undefined,
      elapsedWorkingDays: elapsedWorkingDaysHit ? Math.floor(elapsedWorkingDays.value) : undefined,
      totalWorkingDays: totalWorkingDaysHit ? Math.floor(totalWorkingDays.value) : undefined,
      metricType: metric,
      sourceSheet: sheetName,
      campaignName,
      reportDate: detectedRowDate || activeSectionDate,
      rowIdx: i + 1,
    });
  }

  return {
    format: isAllMetrics ? 'All Metrics' : 'Single Metric',
    entries,
    invalidRows,
    warnings,
    errors,
  };
}

// Build the ProductionDetail write payload from a parsed row, mapping the
// selected metric plus any ACQ fields (NTB / supplementary / seat category).
function buildDetailData(row: ParsedEntry, metricType: string): Record<string, any> {
  const data: Record<string, any> = {
    transmittals: BigInt(0),
    approvals: BigInt(0),
    booked: BigInt(0),
    volume: BigInt(row.volume),
  };
  if (metricType === 'transmittals') data.transmittals = BigInt(row.count);
  else if (metricType === 'approvals') data.approvals = BigInt(row.count);
  else if (metricType === 'booked') data.booked = BigInt(row.count);
  else if (metricType === 'activations') data.activations = BigInt(row.count);
  else if (metricType === 'all_metrics') {
    data.transmittals = BigInt(row.transmittals || 0);
    data.approvals = BigInt(row.approvals || 0);
    data.booked = BigInt(row.booked || 0);
    data.activations = BigInt(row.activations || 0);
  }
  // ACQ acquisition metrics
  if (row.ntb !== undefined) data.ntb = BigInt(row.ntb || 0);
  if (row.supplementary !== undefined) data.supplementary = BigInt(row.supplementary || 0);
  if (row.seatCategory) data.seatCategory = row.seatCategory;
  if (row.cardLevel) data.cardLevel = row.cardLevel;
  if (row.cardLevelLabel) data.cardLevelLabel = row.cardLevelLabel;
  if (row.grandTotal !== undefined) data.cardLevelGrandTotal = BigInt(Math.round(row.grandTotal));
  if (row.nickname !== undefined) data.sourceNickname = row.nickname;
  if (row.finalTotal !== undefined) data.cardLevelFinalTotal = BigInt(Math.round(row.finalTotal));
  if (row.firstPeriodTotal !== undefined) data.cardLevelFirstPeriodTotal = BigInt(Math.round(row.firstPeriodTotal));
  if (row.secondPeriodTotal !== undefined) data.cardLevelSecondPeriodTotal = BigInt(Math.round(row.secondPeriodTotal));
  if (row.workbookGrandTotal !== undefined) data.cardLevelWorkbookGrandTotal = BigInt(Math.round(row.workbookGrandTotal));
  if (row.ranking !== undefined) data.cardLevelRanking = Math.round(row.ranking);
  if (row.monthValues !== undefined) data.cardLevelMonthValues = row.monthValues;
  if (row.sourceSheet) data.sourceSheet = row.sourceSheet;
  if (row.agentCode) data.agentCode = row.agentCode;
  if (row.agentLevel) data.agentLevel = row.agentLevel;
  if (row.dateHired) data.dateHired = row.dateHired;
  if (row.agentType) data.agentType = row.agentType;
  if (row.monthlyGoal !== undefined) data.monthlyGoal = row.monthlyGoal;
  if (row.monthlyActual !== undefined) data.monthlyActual = row.monthlyActual;
  if (row.monthlyAchievement !== undefined) data.monthlyAchievement = row.monthlyAchievement;
  if (row.overallGoal !== undefined) data.overallGoal = row.overallGoal;
  if (row.overallActual !== undefined) data.overallActual = row.overallActual;
  if (row.overallAchievement !== undefined) data.overallAchievement = row.overallAchievement;
  if (row.transmittedVolume !== undefined) data.transmittedVolume = BigInt(row.transmittedVolume || 0);
  if (row.approvalsVolume !== undefined) data.approvalsVolume = BigInt(row.approvalsVolume || 0);
  if (row.bookedVolume !== undefined) data.bookedVolume = BigInt(row.bookedVolume || 0);
  // MB PL wide-format per-category totals
  if (row.bauPayrollTxn !== undefined) {
    data.bauPayrollTxn = BigInt(row.bauPayrollTxn || 0);
    data.bauPayrollVol = BigInt(row.bauPayrollVol || 0);
    data.bauDepositorTxn = BigInt(row.bauDepositorTxn || 0);
    data.bauDepositorVol = BigInt(row.bauDepositorVol || 0);
    data.topupPayrollTxn = BigInt(row.topupPayrollTxn || 0);
    data.topupPayrollVol = BigInt(row.topupPayrollVol || 0);
    data.topupDepositorTxn = BigInt(row.topupDepositorTxn || 0);
    data.topupDepositorVol = BigInt(row.topupDepositorVol || 0);
    data.openMarketTxn = BigInt(row.openMarketTxn || 0);
    data.openMarketVol = BigInt(row.openMarketVol || 0);
  }
  // MB PA wide-format per-category totals
  if (row.c2gTxn !== undefined) {
    data.c2gTxn = BigInt(row.c2gTxn || 0);
    data.c2gVol = BigInt(row.c2gVol || 0);
    data.btTxn = BigInt(row.btTxn || 0);
    data.btVol = BigInt(row.btVol || 0);
    data.balconTxn = BigInt(row.balconTxn || 0);
    data.balconVol = BigInt(row.balconVol || 0);
    data.grandTotalTxn = BigInt(row.grandTotalTxn || 0);
    data.grandTotalVol = BigInt(row.grandTotalVol || 0);
  }
  return data;
}

function buildDetailDataForWrite(row: ParsedEntry, metricType: string, partial = false): Record<string, any> {
  const effectiveMetric = row.metricType || metricType;
  const data: Record<string, any> = partial ? {} : {
    transmittals: BigInt(0),
    approvals: BigInt(0),
    booked: BigInt(0),
    volume: BigInt(0),
  };

  if (!partial || row.volume !== undefined) data.volume = BigInt(Math.round(row.volume || 0));
  if (effectiveMetric === 'transmittals') data.transmittals = BigInt(row.count || 0);
  else if (effectiveMetric === 'approvals') data.approvals = BigInt(row.count || 0);
  else if (effectiveMetric === 'booked') data.booked = BigInt(row.count || 0);
  else if (effectiveMetric === 'activations') data.activations = BigInt(row.count || 0);
  else if (effectiveMetric === 'all_metrics') {
    data.transmittals = BigInt(row.transmittals || 0);
    data.approvals = BigInt(row.approvals || 0);
    data.booked = BigInt(row.booked || 0);
    data.activations = BigInt(row.activations || 0);
  }
  if (row.ntb !== undefined) data.ntb = BigInt(row.ntb || 0);
  if (row.supplementary !== undefined) data.supplementary = BigInt(row.supplementary || 0);
  if (row.seatCategory) data.seatCategory = row.seatCategory;
  if (row.cardLevel) data.cardLevel = row.cardLevel;
  if (row.cardLevelLabel) data.cardLevelLabel = row.cardLevelLabel;
  if (row.grandTotal !== undefined) data.cardLevelGrandTotal = BigInt(Math.round(row.grandTotal));
  if (row.nickname !== undefined) data.sourceNickname = row.nickname;
  if (row.finalTotal !== undefined) data.cardLevelFinalTotal = BigInt(Math.round(row.finalTotal));
  if (row.firstPeriodTotal !== undefined) data.cardLevelFirstPeriodTotal = BigInt(Math.round(row.firstPeriodTotal));
  if (row.secondPeriodTotal !== undefined) data.cardLevelSecondPeriodTotal = BigInt(Math.round(row.secondPeriodTotal));
  if (row.workbookGrandTotal !== undefined) data.cardLevelWorkbookGrandTotal = BigInt(Math.round(row.workbookGrandTotal));
  if (row.ranking !== undefined) data.cardLevelRanking = Math.round(row.ranking);
  if (row.monthValues !== undefined) data.cardLevelMonthValues = row.monthValues;
  if (row.sourceSheet) data.sourceSheet = row.sourceSheet;
  if (row.agentCode) data.agentCode = row.agentCode;
  if (row.agentLevel) data.agentLevel = row.agentLevel;
  if (row.dateHired) data.dateHired = row.dateHired;
  if (row.agentType) data.agentType = row.agentType;
  for (const key of ['monthlyGoal', 'monthlyActual', 'monthlyAchievement', 'overallGoal', 'overallActual', 'overallAchievement'] as const) {
    if (row[key] !== undefined) data[key] = row[key];
  }
  if (row.transmittedVolume !== undefined) data.transmittedVolume = BigInt(row.transmittedVolume || 0);
  if (row.approvalsVolume !== undefined) data.approvalsVolume = BigInt(row.approvalsVolume || 0);
  if (row.bookedVolume !== undefined) data.bookedVolume = BigInt(row.bookedVolume || 0);

  for (const key of [
    'bauPayrollTxn', 'bauPayrollVol', 'bauDepositorTxn', 'bauDepositorVol',
    'topupPayrollTxn', 'topupPayrollVol', 'topupDepositorTxn', 'topupDepositorVol',
    'openMarketTxn', 'openMarketVol', 'c2gTxn', 'c2gVol', 'btTxn', 'btVol',
    'balconTxn', 'balconVol', 'grandTotalTxn', 'grandTotalVol',
  ] as const) {
    if (row[key] !== undefined) data[key] = BigInt(row[key] || 0);
  }
  return data;
}

function detailResponse(row: ParsedEntry, agentName: string, metricType: string) {
  const effectiveMetric = row.metricType || metricType;
  const detail: any = {
    row: row.rowIdx,
    sheet: row.sourceSheet,
    campaign: row.campaignName,
    agent: agentName,
    date: row.reportDate ? ymd(row.reportDate) : '',
    volume: row.volume,
    cardLevel: row.cardLevel,
    cardLevelLabel: row.cardLevelLabel,
    grandTotal: row.grandTotal,
    nickname: row.nickname,
    finalTotal: row.finalTotal,
    wholeYearTotal: row.wholeYearTotal,
    ranking: row.ranking,
  };
  if (effectiveMetric === 'all_metrics') {
    detail.transmittals = row.transmittals;
    detail.approvals = row.approvals;
    detail.booked = row.booked;
  } else if (effectiveMetric === 'acq') {
    detail.ntb = row.ntb;
    detail.supplementary = row.supplementary;
    detail.seatCategory = row.seatCategory;
  } else {
    detail[effectiveMetric] = row.count;
  }
  return detail;
}

async function getAssignedCampaigns(userId: string, primaryCampaignId?: string | null): Promise<AssignedCampaign[]> {
  const assigned = await prisma.userCampaign.findMany({
    where: { userId },
    select: { campaign: { select: { id: true, campaignName: true } } },
  });
  const campaigns = assigned.map((row) => row.campaign);
  if (primaryCampaignId && !campaigns.some((campaign) => campaign.id === primaryCampaignId)) {
    const primary = await prisma.campaign.findUnique({ where: { id: primaryCampaignId }, select: { id: true, campaignName: true } });
    if (primary) campaigns.push(primary);
  }
  return campaigns;
}

async function ensureBpiWorkbookCampaigns(userId: string) {
  const definitions = [
    { campaignName: 'BPI SIP LOANS', goalType: 'dashboard_import', kpiMetric: 'volume' },
    { campaignName: 'BPI PL', goalType: 'volume', kpiMetric: 'volume' },
  ];
  return prisma.$transaction(async (tx) => {
    const campaigns: AssignedCampaign[] = [];
    const createdCampaignIds: string[] = [];
    for (const definition of definitions) {
      const normalizedName = definition.campaignName.toUpperCase();
      let campaign = await tx.campaign.findFirst({
        where: { OR: [
          { normalizedName },
          { campaignName: { equals: definition.campaignName, mode: 'insensitive' } },
        ] },
        select: { id: true, campaignName: true, isActive: true },
      });
      if (!campaign) {
        campaign = await tx.campaign.create({
          data: {
            campaignName: definition.campaignName,
            normalizedName,
            isActive: true,
            goalType: definition.goalType,
            monthlyGoal: 0,
            kpiMetric: definition.kpiMetric,
          },
          select: { id: true, campaignName: true, isActive: true },
        });
        createdCampaignIds.push(campaign.id);
      } else if (!campaign.isActive || definition.campaignName === 'BPI PL') {
        campaign = await tx.campaign.update({
          where: { id: campaign.id },
          data: { isActive: true, ...(definition.campaignName === 'BPI PL' ? { kpiMetric: 'volume' } : {}) },
          select: { id: true, campaignName: true, isActive: true },
        });
      }
      await tx.userCampaign.upsert({
        where: { userId_campaignId: { userId, campaignId: campaign.id } },
        update: {},
        create: { userId, campaignId: campaign.id },
      });
      campaigns.push({ id: campaign.id, campaignName: campaign.campaignName });
    }
    return { campaigns, createdCampaignIds };
  });
}

function classifyEntries(entries: ParsedEntry[], agentsByCampaign: Map<string, { id: string; name: string }[]>) {
  const matched: any[] = [];
  const notFound: any[] = [];
  const reviewSeen = new Set<string>();
  for (const entry of entries) {
    const reviewKey = `${entry.campaignId || ''}|${normalizeAgentName(entry.name)}`;
    if (reviewSeen.has(reviewKey)) continue;
    reviewSeen.add(reviewKey);
    const agent = (agentsByCampaign.get(entry.campaignId || '') || []).find((candidate) => agentNameMatches(candidate.name, entry.name));
    const baseData: any = {
      name: entry.name,
      count: entry.count,
      volume: entry.volume,
      sheet: entry.sourceSheet,
      campaignId: entry.campaignId,
      campaignName: entry.campaignName,
      metricType: entry.metricType,
      reportDate: entry.reportDate ? ymd(entry.reportDate) : '',
      row: entry.rowIdx,
      goal: entry.monthlyGoal,
      actual: entry.monthlyActual,
      achievement: entry.monthlyAchievement,
      cardLevel: entry.cardLevel,
      cardLevelLabel: entry.cardLevelLabel,
      grandTotal: entry.grandTotal,
    };
    if (entry.metricType === 'all_metrics') {
      baseData.transmittals = entry.transmittals;
      baseData.approvals = entry.approvals;
      baseData.booked = entry.booked;
      baseData.activations = entry.activations;
    }
    for (const key of MB_PA_DETAIL_KEYS) {
      if (entry[key] !== undefined) baseData[key] = entry[key];
    }
    if (entry.ntb !== undefined || entry.seatCategory !== undefined) {
      baseData.ntb = entry.ntb ?? 0;
      baseData.supplementary = entry.supplementary ?? 0;
      baseData.seatCategory = entry.seatCategory ?? '';
    }
    if (agent) matched.push({ ...baseData, agentId: agent.id, agentName: agent.name });
    else notFound.push(baseData);
  }
  const sorter = (a: any, b: any) => (b.volume !== a.volume ? b.volume - a.volume : b.count - a.count);
  matched.sort(sorter);
  notFound.sort(sorter);
  return { matched, notFound };
}

function normalizedMetricKey(
  campaignId: string,
  agentId: string,
  metricType: string,
  reportDate: Date,
  reportPeriodType: ReportPeriodType,
  cardLevel = ''
) {
  return `${campaignId}|${agentId}|${metricType}|${reportPeriodType}|${ymd(reportDate)}|${cardLevel}`;
}

async function persistImportedCampaignSettings(tx: Prisma.TransactionClient, entries: ParsedEntry[]) {
  const settings = new Map<string, {
    campaignId: string;
    month: number;
    year: number;
    teamGoals: Set<number>;
    elapsedWorkingDays: Set<number>;
    totalWorkingDays: Set<number>;
  }>();
  for (const entry of entries) {
    if (!entry.campaignId || !entry.reportDate) continue;
    if (entry.teamGoal == null && entry.elapsedWorkingDays == null && entry.totalWorkingDays == null) continue;
    const month = entry.reportDate.getMonth() + 1;
    const year = entry.reportDate.getFullYear();
    const key = `${entry.campaignId}|${year}|${month}`;
    const current = settings.get(key) ?? {
      campaignId: entry.campaignId,
      month,
      year,
      teamGoals: new Set<number>(),
      elapsedWorkingDays: new Set<number>(),
      totalWorkingDays: new Set<number>(),
    };
    if (entry.teamGoal != null && entry.teamGoal > 0) current.teamGoals.add(entry.teamGoal);
    if (entry.elapsedWorkingDays != null && entry.elapsedWorkingDays > 0) current.elapsedWorkingDays.add(entry.elapsedWorkingDays);
    if (entry.totalWorkingDays != null && entry.totalWorkingDays > 0) current.totalWorkingDays.add(entry.totalWorkingDays);
    settings.set(key, current);
  }

  for (const setting of settings.values()) {
    if (setting.teamGoals.size > 1 || setting.elapsedWorkingDays.size > 1 || setting.totalWorkingDays.size > 1) {
      throw new Error(`Conflicting campaign settings were found for ${setting.year}-${String(setting.month).padStart(2, '0')}.`);
    }
    const teamGoal = [...setting.teamGoals][0];
    const elapsed = [...setting.elapsedWorkingDays][0];
    const total = [...setting.totalWorkingDays][0];
    const update: Record<string, number> = {};
    if (teamGoal != null) update.monthlyGoal = teamGoal;
    if (elapsed != null) update.daysLapsed = elapsed;
    if (total != null) update.workingDays = total;
    if (!Object.keys(update).length) continue;
    await tx.campaignGoal.upsert({
      where: { campaignId_month_year: { campaignId: setting.campaignId, month: setting.month, year: setting.year } },
      create: {
        campaignId: setting.campaignId,
        month: setting.month,
        year: setting.year,
        monthlyGoal: teamGoal ?? 0,
        daysLapsed: elapsed ?? 0,
        workingDays: total ?? 22,
      },
      update,
    });
  }
}

function legacyMetricTypes(detail: any): string[] {
  const importedType = detail.productionEntry?.importMetricType;
  if (importedType && !['all', 'all_metrics', 'acq'].includes(importedType)) return [importedType];
  if (importedType === 'acq') return ['ntb', 'supplementary'];
  if (importedType === 'all' || importedType === 'all_metrics') {
    return ['transmittals', 'approvals', 'booked', 'activations', ...(detail.monthlyGoal != null ? ['goal'] : []), ...(detail.monthlyActual != null ? ['actual'] : []), ...(detail.monthlyAchievement != null ? ['achievement'] : [])];
  }
  const inferred: string[] = [];
  if (Number(detail.transmittals) !== 0) inferred.push('transmittals');
  if (Number(detail.approvals) !== 0) inferred.push('approvals');
  if (Number(detail.booked) !== 0) inferred.push('booked');
  if (Number(detail.activations) !== 0) inferred.push('activations');
  if (Number(detail.ntb) !== 0) inferred.push('ntb');
  if (Number(detail.supplementary) !== 0) inferred.push('supplementary');
  if (detail.monthlyGoal != null) inferred.push('goal');
  if (detail.monthlyActual != null) inferred.push('actual');
  if (detail.monthlyAchievement != null) inferred.push('achievement');
  return inferred;
}

function monthSummaryFromRecords(records: any[], sheets: SheetPreview[]) {
  const summary = new Map<string, { month: string; label: string; reportDate: string; new: number; existing: number; invalid: number }>();
  const get = (date: string) => {
    const month = date.slice(0, 7);
    const [year, monthNumber] = month.split('-').map(Number);
    const current = summary.get(month) || { month, label: `${MONTH_NAMES[monthNumber - 1]} ${year}`, reportDate: `${month}-01`, new: 0, existing: 0, invalid: 0 };
    summary.set(month, current);
    return current;
  };
  for (const record of records) {
    const item = get(record.reportDate);
    if (record.status === 'Existing') item.existing++;
    else item.new++;
  }
  for (const sheet of sheets) {
    if (sheet.invalidRows > 0) get(sheet.reportDate).invalid += sheet.invalidRows;
  }
  return [...summary.values()].sort((a, b) => a.month.localeCompare(b.month));
}

function kpiReportDate(record: Pick<ParsedKpiRow, 'year' | 'month'>) {
  return `${record.year}-${String(record.month).padStart(2, '0')}-01`;
}

function uniqueKpiPeople<T extends { name: string }>(people: T[]) {
  return people.filter((person, index) =>
    people.findIndex((candidate) => agentNameMatches(candidate.name, person.name)) === index
  );
}

async function buildKpiBulkPreview(
  parsed: KpiWorkbookResult,
  campaign: AssignedCampaign,
) {
  const agents = await prisma.user.findMany({
    where: {
      role: 'AGENT',
      OR: [
        { campaignId: campaign.id },
        { campaignAssignments: { some: { campaignId: campaign.id } } },
      ],
    },
    select: { id: true, name: true },
  });
  const periods = [...new Map(parsed.records.map((record) => [
    `${record.year}-${record.month}`,
    { year: record.year, month: record.month },
  ])).values()];
  const existing = periods.length
    ? await prisma.collectorKpiRecord.findMany({
        where: { campaignId: campaign.id, OR: periods },
        select: { employeeId: true, year: true, month: true },
      })
    : [];
  const existingKeys = new Set(existing.map((record) => `${record.employeeId}:${record.year}:${record.month}`));
  const matchedPeople: Array<any> = [];
  const newPeople: Array<any> = [];
  const previewRecords: Array<any> = [];
  const metricDefinitions = [
    ['qa', 'actualQa', 'goalQa', 'achievementQa'],
    ['aht', 'actualAht', 'goalAht', 'achievementAht'],
    ['adherence', 'actualAdherence', 'goalAdherence', 'achievementAdherence'],
    ['cm', 'actualCm', 'goalCm', 'achievementCm'],
    ['cd', 'actualCd', 'goalCd', 'achievementCd'],
  ] as const;

  for (const record of parsed.records) {
    const agent = agents.find((candidate) => agentNameMatches(candidate.name, record.employeeName));
    const reportDate = kpiReportDate(record);
    const existingRecord = Boolean(agent && existingKeys.has(`${agent.id}:${record.year}:${record.month}`));
    const basePerson = {
      name: record.employeeName,
      count: 0,
      volume: 0,
      sheet: record.sourceSheet,
      campaignName: campaign.campaignName,
      metricType: 'kpi',
      reportDate,
      row: record.sourceRow,
    };
    if (agent) matchedPeople.push({ ...basePerson, agentId: agent.id, agentName: agent.name });
    else if (record.errors.length === 0) newPeople.push(basePerson);

    const achievements = calculateKpiAchievements(record);
    for (const [metricType, actualField, goalField, achievementField] of metricDefinitions) {
      const actual = record[actualField];
      const goal = record[goalField];
      if (actual == null && goal == null) continue;
      previewRecords.push({
        sheet: record.sourceSheet,
        campaignName: campaign.campaignName,
        agentName: agent?.name || record.employeeName,
        reportPeriodType: 'monthly',
        reportDate,
        metricType,
        count: null,
        volume: null,
        goal,
        actual,
        achievement: achievements[achievementField],
        status: existingRecord ? 'Existing' : record.errors.length ? 'Invalid' : 'New',
        previewStatus: existingRecord ? 'Existing' : record.errors.length ? 'Invalid' : agent ? 'New' : 'New Agent',
        validationMessage: record.errors.join(' ') || record.warnings.join(' ') || undefined,
        row: record.sourceRow,
      });
    }
  }

  const worksheets = parsed.worksheets.map((sheet) => {
    const sheetRecords = parsed.records.filter((record) => record.sourceSheet === sheet.name);
    const validRows = sheetRecords.filter((record) => record.errors.length === 0).length;
    const duplicateRows = sheetRecords.filter((record) => {
      const agent = agents.find((candidate) => agentNameMatches(candidate.name, record.employeeName));
      return Boolean(agent && existingKeys.has(`${agent.id}:${record.year}:${record.month}`));
    }).length;
    const firstRecord = sheetRecords[0];
    return {
      key: `kpi::${sheet.name}`,
      sheetName: sheet.name,
      hidden: false,
      selected: sheet.supported && !sheet.error && validRows > 0,
      format: 'BDO CCC KPI Actuals / Goal',
      campaignId: campaign.id,
      campaignName: campaign.campaignName,
      campaignMapping: 'selected' as const,
      metricType: 'kpi',
      metricSource: 'sheet' as const,
      reportDate: firstRecord ? kpiReportDate(firstRecord) : '',
      totalRows: sheetRecords.length,
      validRows,
      invalidRows: sheetRecords.length - validRows,
      duplicateRows,
      detectedMonths: firstRecord ? [`${MONTH_NAMES[firstRecord.month - 1]} ${firstRecord.year}`] : [],
      detectedMetrics: ['QA', 'AHT', 'Adherence', 'CM', 'CD'],
      warnings: [],
      errors: sheet.error ? [sheet.error] : [],
      matched: [],
      notFound: [],
      entries: [],
    } satisfies SheetPreview;
  });
  const supported = worksheets.filter((sheet) => sheet.selected);
  const uniqueMatched = uniqueKpiPeople(matchedPeople);
  const uniqueNew = uniqueKpiPeople(newPeople);
  const uniqueAgentNames = new Set(parsed.records.map((record) => normalizeAgentName(record.employeeName)));
  return {
    preview: true,
    multiSheet: true,
    kpiWorkbook: true,
    matched: uniqueMatched,
    notFound: uniqueNew,
    metricType: 'kpi',
    reportPeriodType: 'monthly',
    reportDate: supported[0]?.reportDate || '',
    previewRecords,
    monthSummary: monthSummaryFromRecords(previewRecords.filter((record) => record.metricType === 'qa'), worksheets),
    workbookSummary: {
      totalWorksheets: worksheets.length,
      worksheetsAccepted: supported.length,
      worksheetsSkipped: worksheets.length - supported.length,
      totalValidRecords: worksheets.reduce((sum, sheet) => sum + sheet.validRows, 0),
      totalInvalidRecords: worksheets.reduce((sum, sheet) => sum + sheet.invalidRows, 0),
      totalDuplicateRecords: worksheets.reduce((sum, sheet) => sum + sheet.duplicateRows, 0),
      totalUnmappedRecords: 0,
      workbookYear: parsed.records[0]?.year,
      supportedWorksheets: supported.map((sheet) => sheet.sheetName),
      unsupportedWorksheets: worksheets.filter((sheet) => !sheet.selected).map((sheet) => sheet.sheetName),
      detectedMonths: supported.flatMap((sheet) => sheet.detectedMonths || []),
      detectedCategories: ['Actuals', 'Goal'],
      detectedMetrics: ['QA', 'AHT', 'Adherence', 'CM', 'CD'],
      agentCount: uniqueAgentNames.size,
      teamLeaderCount: 0,
      manpowerRecordCount: parsed.records.length,
    },
    worksheetPreviews: worksheets,
    validationWarnings: parsed.records
      .filter((record) => record.errors.length || record.warnings.length)
      .slice(0, 200)
      .map((record) => `${record.sourceSheet} row ${record.sourceRow}: ${[...record.errors, ...record.warnings].join(' ')}`),
  };
}

async function persistKpiBulkImport({
  parsed,
  campaign,
  fileName,
  importedById,
  selectedWorksheetKeys,
  confirmedNewAgents,
  duplicateMode,
}: {
  parsed: KpiWorkbookResult;
  campaign: AssignedCampaign;
  fileName: string;
  importedById: string;
  selectedWorksheetKeys: string[];
  confirmedNewAgents: string[];
  duplicateMode: DuplicateMode;
}) {
  const selectedSheetNames = new Set(
    selectedWorksheetKeys.map((key) => key.startsWith('kpi::') ? key.slice(5) : key)
  );
  const records = parsed.records.filter((record) => selectedSheetNames.has(record.sourceSheet));
  if (!records.length) throw new Error('No valid KPI worksheets were selected for import.');

  return prisma.$transaction(async (tx) => {
    const agents = await tx.user.findMany({
      where: {
        role: 'AGENT',
        OR: [
          { campaignId: campaign.id },
          { campaignAssignments: { some: { campaignId: campaign.id } } },
        ],
      },
      select: { id: true, name: true },
    });
    const findAgent = (name: string) => agents.find((agent) => agentNameMatches(agent.name, name)) || null;
    let createdAgents = 0;
    for (const name of uniqueKpiPeople(confirmedNewAgents.map((value) => ({ name: value }))).map((item) => item.name)) {
      if (findAgent(name)) continue;
      const created = await tx.user.create({
        data: {
          name: name.trim(),
          email: nameToEmail(name),
          password: await bcrypt.hash(crypto.randomUUID(), 10),
          role: 'AGENT',
          campaignId: campaign.id,
        },
        select: { id: true, name: true },
      });
      agents.push(created);
      createdAgents += 1;
    }

    const batch = await tx.kpiImportBatch.create({
      data: {
        originalFileName: fileName.slice(0, 255),
        campaignId: campaign.id,
        uploadedById: importedById,
        totalRows: records.length,
        duplicateMode: duplicateMode.toUpperCase(),
        status: 'IMPORTING',
      },
    });
    const periods = [...new Map(records.map((record) => [
      `${record.year}-${record.month}`,
      { year: record.year, month: record.month },
    ])).values()];
    if (duplicateMode === 'replace_period' && periods.length) {
      await tx.collectorKpiRecord.deleteMany({
        where: { campaignId: campaign.id, OR: periods },
      });
    }

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    let invalid = 0;
    let duplicates = 0;
    let unmatched = 0;
    let warningRows = 0;
    const details: any[] = [];
    const issues: Prisma.KpiImportIssueCreateManyInput[] = [];
    const periodDates: Date[] = [];
    const seen = new Set<string>();

    for (const record of records) {
      const agent = findAgent(record.employeeName);
      if (!agent) {
        unmatched += 1;
        skipped += 1;
        issues.push({
          batchId: batch.id,
          sourceSheet: record.sourceSheet,
          sourceRow: record.sourceRow,
          employeeName: record.employeeName,
          kind: 'UNMATCHED_EMPLOYEE',
          message: 'No approved BDO CCC agent matched this workbook row.',
        });
        continue;
      }
      const naturalKey = `${agent.id}:${record.year}:${record.month}`;
      if (seen.has(naturalKey)) {
        duplicates += 1;
        skipped += 1;
        issues.push({
          batchId: batch.id,
          sourceSheet: record.sourceSheet,
          sourceRow: record.sourceRow,
          employeeName: record.employeeName,
          kind: 'DUPLICATE_IN_WORKBOOK',
          message: 'The employee appears more than once in this workbook period.',
        });
        continue;
      }
      seen.add(naturalKey);
      if (record.errors.length) {
        invalid += 1;
        skipped += 1;
        issues.push(...record.errors.map((message) => ({
          batchId: batch.id,
          sourceSheet: record.sourceSheet,
          sourceRow: record.sourceRow,
          employeeName: record.employeeName,
          kind: 'VALIDATION_ERROR',
          message,
        })));
        continue;
      }
      if (record.warnings.length) warningRows += 1;
      const achievements = calculateKpiAchievements(record);
      const periodDate = new Date(Date.UTC(record.year, record.month - 1, 1));
      periodDates.push(periodDate);
      const recordData = {
        employeeNameSnapshot: agent.name,
        month: record.month,
        year: record.year,
        periodDate,
        tenure: record.tenure,
        actualQa: record.actualQa,
        actualAht: record.actualAht,
        actualAdherence: record.actualAdherence,
        actualCm: record.actualCm,
        actualCd: record.actualCd,
        goalQa: record.goalQa,
        goalAht: record.goalAht,
        goalAdherence: record.goalAdherence,
        goalCm: record.goalCm,
        goalCd: record.goalCd,
        ...achievements,
        importBatchId: batch.id,
        sourceSheet: record.sourceSheet,
        sourceRow: record.sourceRow,
      };
      const existing = await tx.collectorKpiRecord.findUnique({
        where: {
          employeeId_campaignId_year_month: {
            employeeId: agent.id,
            campaignId: campaign.id,
            year: record.year,
            month: record.month,
          },
        },
      });
      if (existing && duplicateMode === 'skip') {
        duplicates += 1;
        skipped += 1;
        await tx.kpiImportEvent.create({ data: {
          batchId: batch.id,
          recordId: existing.id,
          employeeId: agent.id,
          employeeName: agent.name,
          action: 'KPI_RECORD_SKIPPED_EXISTING',
          reason: 'Existing record preserved by the selected skip policy.',
          sourceSheet: record.sourceSheet,
          sourceRow: record.sourceRow,
        } });
        continue;
      }
      let savedId: string;
      if (existing) {
        const saved = await tx.collectorKpiRecord.update({ where: { id: existing.id }, data: recordData });
        savedId = saved.id;
        updated += 1;
      } else {
        const saved = await tx.collectorKpiRecord.create({
          data: { ...recordData, employeeId: agent.id, campaignId: campaign.id },
        });
        savedId = saved.id;
        inserted += 1;
      }
      await tx.kpiImportEvent.create({ data: {
        batchId: batch.id,
        recordId: savedId,
        employeeId: agent.id,
        employeeName: agent.name,
        action: existing ? 'KPI_RECORD_UPDATED' : 'KPI_RECORD_CREATED',
        newValues: {
          month: record.month,
          year: record.year,
          actualQa: record.actualQa,
          actualAht: record.actualAht,
          actualAdherence: record.actualAdherence,
          actualCm: record.actualCm,
          actualCd: record.actualCd,
          goalQa: record.goalQa,
          goalAht: record.goalAht,
          goalAdherence: record.goalAdherence,
          goalCm: record.goalCm,
          goalCd: record.goalCd,
          ...achievements,
        },
        sourceSheet: record.sourceSheet,
        sourceRow: record.sourceRow,
      } });
      details.push({
        row: record.sourceRow,
        agent: agent.name,
        date: kpiReportDate(record),
        sheet: record.sourceSheet,
        qa: record.actualQa,
        aht: record.actualAht,
        adherence: record.actualAdherence,
        cm: record.actualCm,
        cd: record.actualCd,
      });
    }

    if (issues.length) await tx.kpiImportIssue.createMany({ data: issues });
    await tx.kpiImportBatch.update({
      where: { id: batch.id },
      data: {
        periodStart: periodDates.length ? new Date(Math.min(...periodDates.map(Number))) : null,
        periodEnd: periodDates.length ? new Date(Math.max(...periodDates.map(Number))) : null,
        successfulRows: inserted,
        updatedRows: updated,
        skippedRows: skipped,
        failedRows: invalid,
        duplicateRows: duplicates,
        unmatchedRows: unmatched,
        warningRows,
        status: invalid || unmatched ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED',
        completedAt: new Date(),
      },
    });
    return {
      message: `KPI import completed: ${inserted} inserted, ${updated} updated, ${skipped} skipped, and ${invalid} invalid.`,
      batchId: batch.id,
      kpiWorkbook: true,
      importedCampaignIds: [campaign.id],
      importedCampaigns: 1,
      inserted,
      updated,
      skipped,
      invalid,
      success: inserted + updated,
      created: createdAgents,
      normalizedImported: inserted,
      normalizedDuplicates: duplicates,
      errors: issues.filter((issue) => issue.kind === 'VALIDATION_ERROR' || issue.kind === 'UNMATCHED_EMPLOYEE').map((issue) => `${issue.sourceSheet} row ${issue.sourceRow}: ${issue.message}`),
      warnings: issues.filter((issue) => issue.kind !== 'VALIDATION_ERROR' && issue.kind !== 'UNMATCHED_EMPLOYEE').map((issue) => `${issue.sourceSheet} row ${issue.sourceRow}: ${issue.message}`),
      details,
      workbookSummary: {
        supportedWorksheets: [...selectedSheetNames],
        agentCount: new Set(records.map((record) => normalizeAgentName(record.employeeName))).size,
      },
      worksheetPreviews: parsed.worksheets.filter((sheet) => selectedSheetNames.has(sheet.name)),
    };
  }, { timeout: 120000 });
}

async function buildWorkbookPreview({
  workbook,
  selectedCampaigns,
  metricType,
  selectedReportDate,
  reportPeriodType,
  preloadedWorksheetRows,
  preparsedBdoSgm,
}: {
  workbook: XLSX.WorkBook;
  selectedCampaigns: AssignedCampaign[];
  metricType: string;
  selectedReportDate: Date;
  reportPeriodType: ReportPeriodType;
  preloadedWorksheetRows?: Map<string, any[][]>;
  preparsedBdoSgm?: Map<string, BdoSgmParseResult>;
}) {
  const campaignIds = selectedCampaigns.map((campaign) => campaign.id);
  const campaignAgents = await prisma.user.findMany({
    where: { role: 'AGENT', campaignId: { in: campaignIds } },
    select: { id: true, name: true, campaignId: true },
  });
  const agentsByCampaign = new Map<string, { id: string; name: string }[]>();
  for (const agent of campaignAgents) {
    const bucket = agentsByCampaign.get(agent.campaignId || '') || [];
    bucket.push({ id: agent.id, name: agent.name });
    agentsByCampaign.set(agent.campaignId || '', bucket);
  }

  const hiddenByName = new Map<string, boolean>();
  workbook.Workbook?.Sheets?.forEach((sheetInfo: any, index: number) => {
    hiddenByName.set(workbook.SheetNames[index], Boolean(sheetInfo?.Hidden));
  });

  const worksheetRows = preloadedWorksheetRows || new Map<string, any[][]>(workbook.SheetNames.map((sheetName) => [
    sheetName,
    XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null } as any),
  ]));
  const bdoSgmMode = selectedCampaigns.length === 1 && isBdoSgmCampaign(selectedCampaigns[0].campaignName);
  const bdoSgmBySheet = preparsedBdoSgm || new Map<string, BdoSgmParseResult>(
    bdoSgmMode
      ? workbook.SheetNames.map((sheetName) => {
          const consolidated = parseBdoSgmConsolidatedWorksheet(
            workbook.Sheets[sheetName],
            sheetName,
            selectedReportDate,
            reportPeriodType,
          );
          return [
            sheetName,
            consolidated.detected
              ? consolidated
              : parseBdoSgmWorksheet(worksheetRows.get(sheetName) || [], sheetName, selectedReportDate),
          ];
        })
      : []
  );
  const hasBdoSgmRanking = [...bdoSgmBySheet.values()].some((result) => result.detected);

  const allSeen = new Set<string>();
  const sheets: SheetPreview[] = workbook.SheetNames.map((sheetName, index) => {
    const rows = worksheetRows.get(sheetName) || [];
    const bdoSgm = bdoSgmBySheet.get(sheetName);
    const defaultMapping = mapWorksheetCampaign(sheetName, selectedCampaigns);
    const mbPaCampaigns = selectedCampaigns.filter((campaign) => /\bmb\s*pa\b/i.test(campaign.campaignName));
    const detectedMbPaLayout = isMbPaMonthlyLayout(rows);
    const mbCampaigns = selectedCampaigns.filter((campaign) => /^mb\b/i.test(campaign.campaignName.trim()));
    const detectedMbGoalLayout = isMbGoalAchievementLayout(rows);
    const mapping = detectedMbPaLayout && mbPaCampaigns.length === 1
      ? { campaign: mbPaCampaigns[0], source: 'sheet' as const }
      : detectedMbGoalLayout && defaultMapping.source === 'unresolved' && mbCampaigns.length === 1
        ? { campaign: mbCampaigns[0], source: 'sheet' as const }
        : defaultMapping;
    const reportDate = parseReportDateFromRows(rows, selectedReportDate, sheetName);
    const detectedMetric = bdoSgm?.detected
      ? BDO_SGM_METRIC_TYPE
      : detectMetricFromText(`${sheetName} ${rows.slice(0, 5).flat().join(' ')}`, metricType);
    const campaignSummary = parseCampaignSummaryWorksheet(
      rows,
      sheetName,
      selectedCampaigns,
      reportDate
    );
    const parsed = bdoSgm?.detected
      ? {
          format: bdoSgm.format,
          entries: bdoSgm.records as ParsedEntry[],
          invalidRows: bdoSgm.invalidRows,
          warnings: bdoSgm.warnings,
          errors: bdoSgm.errors,
        }
      : hasBdoSgmRanking
        ? {
            format: 'Unsupported',
            entries: [] as ParsedEntry[],
            invalidRows: 0,
            warnings: rows.filter(rowHasAnyValue).length
              ? ['Worksheet skipped because it does not contain a BDO SGM ranking table.']
              : [],
            errors: [] as string[],
          }
        : campaignSummary?.entries.length
          ? campaignSummary
          : parseDetectedRows(rows, detectedMetric, mapping.campaign.campaignName, sheetName, reportDate);
    const hasPerRecordCampaigns = parsed.format === 'Campaign Summary';
    const entries: ParsedEntry[] = [];
    let duplicateRows = 0;
    const warnings = [...parsed.warnings];
    if (detectedMbPaLayout) warnings.unshift('MB PA layout automatically detected from the TRANS and BILLINGS month blocks.');
    if (detectedMbGoalLayout) warnings.unshift('MB monthly TARGET, ACTUAL, %, SCORE, and ACHIEVEMENT blocks were detected automatically.');
    const sheetSeen = new Set<string>();

    for (const entry of parsed.entries as ParsedEntry[]) {
      const effectiveMetric = entry.metricType || detectedMetric;
      const entryDate = entry.reportDate || reportDate;
      const entryCampaign = entry.campaignId
        ? selectedCampaigns.find((campaign) => campaign.id === entry.campaignId)
        : mapping.campaign;
      if (!entryCampaign) {
        warnings.push(`Row ${entry.rowIdx}: campaign is not authorized for this import.`);
        continue;
      }
      const key = [entryCampaign.id, normalizeAgentName(entry.name), ymd(normalizePeriodDate(entryDate, reportPeriodType)), effectiveMetric, entry.cardLevel || ''].join('|');
      if (sheetSeen.has(key) || allSeen.has(key)) {
        duplicateRows++;
        warnings.push(`Row ${entry.rowIdx}: duplicate ${sheetSeen.has(key) ? 'within this sheet' : 'already found in another sheet'}; it will be skipped.`);
        continue;
      }
      sheetSeen.add(key);
      allSeen.add(key);
      entries.push({
        ...entry,
        campaignId: entryCampaign.id,
        campaignName: entryCampaign.campaignName,
        metricType: effectiveMetric,
        reportDate: entryDate,
      });
    }

    entries.sort((a, b) => (a.reportDate?.getTime() || 0) - (b.reportDate?.getTime() || 0) || a.rowIdx - b.rowIdx);
    const { matched, notFound } = classifyEntries(entries, agentsByCampaign);
    const errors = [...parsed.errors];
    if (hiddenByName.get(sheetName) && entries.length === 0) warnings.push('Hidden sheet skipped because no valid production data was found.');
    if (!hasPerRecordCampaigns && mapping.source === 'selected') warnings.push(`No campaign alias matched this worksheet; using the only selected campaign, ${mapping.campaign.campaignName}.`);
    if (!hasPerRecordCampaigns && mapping.source === 'unresolved') warnings.push('Some worksheets could not be matched to the selected campaigns. Please review the campaign mapping.');
    const detectedCampaigns = [...new Set(entries.map((entry) => entry.campaignName).filter(Boolean))];

    return {
      key: `${index}:${sheetName}`,
      sheetName: sheetName.replace(/[\r\n\t]/g, ' ').slice(0, 80),
      hidden: Boolean(hiddenByName.get(sheetName)),
      selected: entries.length > 0,
      format: entries.length > 0 ? parsed.format : 'Skipped',
      campaignId: entries[0]?.campaignId || mapping.campaign.id,
      campaignName: hasPerRecordCampaigns
        ? `Detected per record (${detectedCampaigns.join(', ')})`
        : mapping.source === 'unresolved' ? 'Campaign mapping required' : mapping.campaign.campaignName,
      campaignMapping: hasPerRecordCampaigns ? 'record' : mapping.source,
      metricType: detectedMetric,
      metricSource: detectedMetric === metricType ? 'selected' : 'sheet',
      reportDate: ymd(entries[0]?.reportDate || reportDate),
      totalRows: rows.filter(rowHasAnyValue).length,
      validRows: entries.length,
      invalidRows: parsed.invalidRows,
      duplicateRows,
      validAgentRows: bdoSgm?.validAgentRows,
      monthlyRecordsDetected: bdoSgm?.monthlyRecordsDetected,
      skippedBlankCells: bdoSgm?.skippedBlankCells,
      warningCount: bdoSgm?.warningCount,
      detectedMonths: bdoSgm?.detectedMonths,
      detectedCardLevels: bdoSgm?.detectedCardLevels,
      validationIssues: bdoSgm?.issues,
      consolidatedAgents: bdoSgm && 'agents' in bdoSgm ? bdoSgm.agents : undefined,
      warnings,
      errors,
      matched,
      notFound,
      entries,
    };
  });

  const accepted = sheets.filter((sheet) => sheet.validRows > 0);
  const candidateDates = sheets.flatMap((sheet) => sheet.entries.map((entry) => normalizePeriodDate(entry.reportDate || selectedReportDate, reportPeriodType)));
  const matchedAgentIds = campaignAgents.map((agent) => agent.id);
  const campaignIdSet = [...new Set(sheets.flatMap((sheet) =>
    sheet.entries.map((entry) => entry.campaignId || sheet.campaignId)
  ))];
  const minDate = candidateDates.length ? new Date(Math.min(...candidateDates.map((date) => date.getTime()))) : selectedReportDate;
  const maxDate = candidateDates.length ? new Date(Math.max(...candidateDates.map((date) => date.getTime()))) : selectedReportDate;
  const [existingMetrics, legacyDetails] = matchedAgentIds.length && candidateDates.length ? await Promise.all([
    prisma.productionMetricRecord.findMany({
      where: { campaignId: { in: campaignIdSet }, agentId: { in: matchedAgentIds }, reportPeriodType, reportDate: { gte: minDate, lte: maxDate } },
      select: { campaignId: true, agentId: true, metricType: true, reportDate: true, cardLevel: true },
    }),
    prisma.productionDetail.findMany({
      where: { campaignId: { in: campaignIdSet }, agentId: { in: matchedAgentIds }, productionEntry: { date: { gte: new Date(minDate.getFullYear(), minDate.getMonth(), 1), lte: new Date(maxDate.getFullYear(), maxDate.getMonth() + 1, 0) } } },
      select: {
        campaignId: true, agentId: true, cardLevel: true, transmittals: true, approvals: true, booked: true, activations: true, ntb: true, supplementary: true,
        monthlyGoal: true, monthlyActual: true, monthlyAchievement: true,
        productionEntry: { select: { date: true, reportPeriodType: true, importMetricType: true } },
      },
    }),
  ]) : [[], []];
  const existingKeys = new Set(existingMetrics.map((record) => normalizedMetricKey(record.campaignId, record.agentId, record.metricType, record.reportDate, reportPeriodType, record.cardLevel)));
  for (const detail of legacyDetails) {
    if (detail.productionEntry.reportPeriodType !== reportPeriodType) continue;
    const normalizedDate = normalizePeriodDate(detail.productionEntry.date, reportPeriodType);
    for (const type of legacyMetricTypes(detail)) existingKeys.add(normalizedMetricKey(detail.campaignId, detail.agentId, type, normalizedDate, reportPeriodType, detail.cardLevel));
  }

  const previewSeen = new Set<string>();
  const previewRecords = sheets.flatMap((sheet) => sheet.entries.flatMap((entry) => {
    const agent = (agentsByCampaign.get(entry.campaignId || '') || []).find((candidate) => agentNameMatches(candidate.name, entry.name));
    const normalizedDate = normalizePeriodDate(entry.reportDate || selectedReportDate, reportPeriodType);
    return expandEntryMetrics(entry).flatMap((metric) => {
      const key = normalizedMetricKey(entry.campaignId || sheet.campaignId, agent?.id || normalizeAgentName(entry.name), metric.metricType, normalizedDate, reportPeriodType, entry.cardLevel);
      if (previewSeen.has(key)) return [];
      previewSeen.add(key);
      return [{
      sheet: entry.sourceSheet || sheet.sheetName,
      campaignName: entry.campaignName || sheet.campaignName,
      agent: agent?.name || entry.name,
      reportPeriodType,
      reportDate: ymd(normalizedDate),
      metricType: metric.metricType,
      count: metric.count ?? null,
      volume: metric.volume ?? null,
      goal: metric.goal ?? null,
      actual: metric.actual ?? null,
      achievement: metric.achievement ?? null,
      cardLevel: entry.cardLevel || '',
      cardLevelLabel: entry.cardLevelLabel || '',
      grandTotal: entry.grandTotal ?? null,
      nickname: entry.nickname || '',
      finalTotal: entry.finalTotal ?? null,
      wholeYearTotal: entry.wholeYearTotal ?? entry.grandTotal ?? null,
      firstPeriodTotal: entry.firstPeriodTotal ?? null,
      secondPeriodTotal: entry.secondPeriodTotal ?? null,
      ranking: entry.ranking ?? null,
      monthValues: entry.monthValues,
      ...(entry.c2gTxn !== undefined && metric.metricType === 'transmittals' ? {
        c2gTxn: entry.c2gTxn, btTxn: entry.btTxn, balconTxn: entry.balconTxn, grandTotalTxn: entry.grandTotalTxn,
        c2gVol: entry.c2gVol, btVol: entry.btVol, balconVol: entry.balconVol, grandTotalVol: entry.grandTotalVol,
      } : {}),
      status: agent && existingKeys.has(key) ? 'Existing' : 'New',
      validationMessage: [
        agent ? '' : 'Agent not found; approve creation before import.',
        entry.grandTotal !== undefined ? `Grand Total: ${entry.grandTotal}.` : '',
        ...(entry.validationErrors || []),
      ].filter(Boolean).join(' '),
      row: entry.rowIdx,
      }];
    });
  })).sort((a, b) => a.reportDate.localeCompare(b.reportDate) || a.campaignName.localeCompare(b.campaignName) || a.agent.localeCompare(b.agent));
  const monthSummary = monthSummaryFromRecords(previewRecords, sheets);
  const consolidatedResults = [...bdoSgmBySheet.values()].filter(
    (result): result is BdoSgmConsolidatedParseResult => result.format === 'BDO SGM Consolidated'
  );
  const consolidatedTotals = consolidatedResults.reduce((totals, result) => ({
    finalFcTotal: totals.finalFcTotal + result.periodTotals.finalFcTotal,
    finalBcTotal: totals.finalBcTotal + result.periodTotals.finalBcTotal,
    wholeYearTotalFc: totals.wholeYearTotalFc + result.periodTotals.wholeYearTotalFc,
    wholeYearTotalBc: totals.wholeYearTotalBc + result.periodTotals.wholeYearTotalBc,
  }), { finalFcTotal: 0, finalBcTotal: 0, wholeYearTotalFc: 0, wholeYearTotalBc: 0 });
  return {
    workbookSummary: {
      totalWorksheets: sheets.length,
      worksheetsAccepted: accepted.length,
      worksheetsSkipped: sheets.length - accepted.length,
      totalValidRecords: sheets.reduce((sum, sheet) => sum + sheet.validRows, 0),
      totalInvalidRecords: sheets.reduce((sum, sheet) => sum + sheet.invalidRows, 0),
      totalDuplicateRecords: sheets.reduce((sum, sheet) => sum + sheet.duplicateRows, 0),
      ...(hasBdoSgmRanking ? {
        bdoSgmRanking: true,
        totalRowsScanned: [...bdoSgmBySheet.values()].reduce((sum, result) => sum + result.rowsScanned, 0),
        validAgentRows: [...bdoSgmBySheet.values()].reduce((sum, result) => sum + result.validAgentRows, 0),
        monthlyRecordsDetected: [...bdoSgmBySheet.values()].reduce((sum, result) => sum + result.monthlyRecordsDetected, 0),
        recordsReadyForImport: previewRecords.length,
        skippedBlankCells: [...bdoSgmBySheet.values()].reduce((sum, result) => sum + result.skippedBlankCells, 0),
        warningCount: [...bdoSgmBySheet.values()].reduce((sum, result) => sum + result.warningCount, 0),
        detectedMonths: [...new Set([...bdoSgmBySheet.values()].flatMap((result) => result.detectedMonths))].sort(),
        bdoSgmConsolidated: [...bdoSgmBySheet.values()].some((result) => result.format === 'BDO SGM Consolidated'),
        supportedWorksheets: sheets.filter((sheet) => sheet.format.startsWith('BDO SGM')).map((sheet) => sheet.sheetName),
        unsupportedWorksheets: sheets.filter((sheet) => !sheet.format.startsWith('BDO SGM')).map((sheet) => sheet.sheetName),
        detectedMetrics: [BDO_SGM_METRIC_TYPE],
        detectedCardLevels: [...new Set([...bdoSgmBySheet.values()].flatMap((result) => result.detectedCardLevels))].sort(),
        agentCount: [...bdoSgmBySheet.values()].reduce((sum, result) => sum + result.validAgentRows, 0),
        ...(consolidatedResults.length ? {
          detectedWorksheet: consolidatedResults[0].agents[0]?.sourceSheet || 'HOH',
          ...consolidatedTotals,
        } : {}),
      } : {}),
    },
    sheets,
    matched: sheets.flatMap((sheet) => sheet.matched),
    notFound: sheets.flatMap((sheet) => sheet.notFound),
    consolidatedAgents: sheets.flatMap((sheet) => sheet.consolidatedAgents || []),
    previewRecords,
    monthSummary,
    detectedRange: monthSummary.length ? { earliestMonth: monthSummary[0].month, latestMonth: monthSummary[monthSummary.length - 1].month } : null,
  };
}

type DashboardNaturalKeyRecord = Pick<BdoImportRecord, 'worksheetSource' | 'recordKind' | 'entityName' | 'category' | 'product' | 'metric' | 'year' | 'month'>;

function bdoNaturalKey(record: DashboardNaturalKeyRecord) {
  return [record.worksheetSource, record.recordKind, record.entityName || '', record.category || '', record.product || '', record.metric, record.year, record.month || 0].map((value) => String(value).trim().toLowerCase()).join('|');
}

function dashboardImportNaturalKey(campaignId: string, record: DashboardNaturalKeyRecord) {
  return `${campaignId}|${bdoNaturalKey(record)}`;
}

function inChunks<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function dashboardMonthLabel(year: number, month: number) {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function buildBdoPreview(workbook: XLSX.WorkBook, reportDate: Date, selectedCampaigns: AssignedCampaign[], reportPeriodType: ReportPeriodType) {
  const parsed = parseBdoDashboardWorkbook(workbook, reportDate);
  const recordMappings = new Map(parsed.records.map((record) => [record, mapWorksheetCampaign(`${record.worksheetSource} ${record.category || ''} ${record.product || ''} ${record.metric}`, selectedCampaigns)]));
  const sheetMappings = new Map<string, { campaign: AssignedCampaign; source: 'sheet' | 'record' | 'selected' | 'unresolved' }>(parsed.sheets.map((sheet) => {
    const records = sheet.records.map((record) => recordMappings.get(record)!);
    const detected = records.filter((mapping) => mapping.source === 'sheet');
    const unresolvedRecords = records.filter((mapping) => mapping.source === 'unresolved');
    if (detected.length && !unresolvedRecords.length) return [sheet.sheetName, { campaign: detected[0].campaign, source: 'record' as const }];
    return [sheet.sheetName, mapWorksheetCampaign(sheet.sheetName, selectedCampaigns)];
  }));
  const seen = new Set<string>();
  let duplicateCount = 0;
  parsed.records = parsed.records.filter((record) => {
    const key = bdoNaturalKey(record);
    if (seen.has(key)) { duplicateCount++; return false; }
    seen.add(key);
    return true;
  });
  const retainedRecords = new Set(parsed.records);
  for (const sheet of parsed.sheets) sheet.records = sheet.records.filter((record) => retainedRecords.has(record));
  const previewRecords = parsed.records.map((record) => {
    const detectedMapping = recordMappings.get(record)!;
    const sheetMapping = sheetMappings.get(record.worksheetSource)!;
    const mapping = detectedMapping.source === 'sheet' ? detectedMapping : sheetMapping;
    return ({
    sheet: record.worksheetSource,
    campaignId: mapping.campaign.id,
    campaignName: mapping.source === 'unresolved' ? 'Campaign mapping required' : mapping.campaign.campaignName,
    agent: record.entityName || record.category || record.metric,
    reportPeriodType,
    reportDate: ymd(record.reportDate),
    metricType: record.metric,
    count: record.numericValue ?? null,
    volume: null,
    goal: record.target ?? null,
    actual: record.actual ?? null,
    achievement: record.achievement ?? null,
    status: record.dataStatus || record.remark ? 'Warning' : 'New',
    validationMessage: record.remark || '',
    row: record.sourceRow,
    });
  });
  const monthMap = new Map<string, any>();
  for (const record of parsed.records) {
    if (!record.month) continue;
    const month = `${record.year}-${String(record.month || 1).padStart(2, '0')}`;
    const current = monthMap.get(month) || { month, label: new Date(record.year, (record.month || 1) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), reportDate: `${month}-01`, new: 0, existing: 0, invalid: 0 };
    current.new++;
    monthMap.set(month, current);
  }
  const worksheetPreviews = parsed.sheets.map((sheet, index) => {
    const mapping = sheetMappings.get(sheet.sheetName)!;
    const mappingWarnings = mapping.source === 'unresolved' ? ['Some worksheets could not be matched to the selected campaigns. Please review the campaign mapping.'] : [];
    return ({
    key: `${index}:${sheet.sheetName}`,
    sheetName: sheet.sheetName,
    hidden: false,
    selected: sheet.records.length > 0,
    format: sheet.detectedType,
    campaignId: mapping.campaign.id,
    campaignName: mapping.source === 'unresolved' ? 'Campaign mapping required' : mapping.source === 'record' ? 'Detected per record' : mapping.campaign.campaignName,
    campaignMapping: mapping.source,
    metricType: 'all_metrics',
    metricSource: 'sheet' as const,
    reportDate: sheet.records[0] ? ymd(sheet.records[0].reportDate) : ymd(reportDate),
    totalRows: sheet.records.length + sheet.warnings.length,
    validRows: sheet.records.length,
    invalidRows: sheet.warnings.filter((warning) => /invalid numeric|formula returned|text value skipped|no valid|malformed/i.test(warning.message)).length,
    warningCount: sheet.warnings.filter((warning) => !/invalid numeric|formula returned|text value skipped|no valid|malformed|unsupported worksheet/i.test(warning.message)).length,
    duplicateRows: 0,
    detectedMonths: sheet.months,
    warnings: [...mappingWarnings, ...sheet.warnings.map((warning) => warning.message)],
    errors: [] as string[],
    status: sheet.status,
    });
  });
  const unmappedRecords = parsed.records.filter((record) => recordMappings.get(record)?.source === 'unresolved').length;
  return {
    parsed,
    recordMappings,
    previewRecords,
    worksheetPreviews,
    monthSummary: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
    workbookSummary: {
      totalWorksheets: workbook.SheetNames.length,
      worksheetsAccepted: parsed.sheets.filter((sheet) => sheet.records.length > 0).length,
      worksheetsSkipped: parsed.sheets.filter((sheet) => sheet.records.length === 0).length,
      totalValidRecords: parsed.records.length,
      totalInvalidRecords: parsed.issues.filter((issue) => /invalid numeric|formula returned|text value skipped|no valid|malformed/i.test(issue.message)).length,
      totalWarningRecords: parsed.issues.filter((issue) => !/invalid numeric|formula returned|text value skipped|no valid|malformed|unsupported worksheet/i.test(issue.message)).length,
      totalDuplicateRecords: duplicateCount,
      inWorkbookDuplicateRecords: duplicateCount,
      totalUnmappedRecords: unmappedRecords,
      workbookYear: parsed.workbookYear,
      supportedWorksheets: parsed.sheets.filter((sheet) => sheet.detectedType !== 'Unsupported').map((sheet) => sheet.sheetName),
      unsupportedWorksheets: parsed.sheets.filter((sheet) => sheet.detectedType === 'Unsupported').map((sheet) => sheet.sheetName),
      detectedMonths: parsed.detectedMonths,
      detectedCategories: parsed.detectedCategories,
      detectedMetrics: parsed.detectedMetrics,
      agentCount: parsed.agents.length,
      teamLeaderCount: parsed.teamLeaders.length,
      manpowerRecordCount: parsed.records.filter((record) => record.recordKind === 'manpower').length,
      recordTypeSummary: {
        production: parsed.records.filter((record) => record.recordKind === 'agent_monitoring' && !/HOH/.test(record.monitoringType || '')).length,
        hoh: parsed.records.filter((record) => record.recordKind === 'agent_monitoring' && /HOH/.test(record.monitoringType || '')).length,
        scorecard: parsed.records.filter((record) => record.recordKind === 'scorecard').length,
        ytd: parsed.records.filter((record) => record.recordKind === 'ytd').length,
        warnings: parsed.issues.length,
      },
      campaignDistribution: selectedCampaigns.map((campaign) => {
        const campaignRecords = parsed.records.filter((record) => recordMappings.get(record)?.campaign.id === campaign.id && recordMappings.get(record)?.source !== 'unresolved');
        return {
          campaignId: campaign.id,
          campaignName: campaign.campaignName,
          worksheets: [...new Set(campaignRecords.map((record) => record.worksheetSource))],
          agents: new Set(campaignRecords.map((record) => record.entityName).filter(Boolean)).size,
          metrics: new Set(campaignRecords.map((record) => record.metric)).size,
          records: campaignRecords.length,
          months: [...new Set(campaignRecords.filter((record) => record.month).map((record) => dashboardMonthLabel(record.year, record.month!)))],
        };
      }).filter((item) => item.records > 0),
    },
  };
}

function buildBpiPreview(workbook: XLSX.WorkBook, reportDate: Date, selectedCampaigns: AssignedCampaign[], reportPeriodType: ReportPeriodType, sourceFileName = '') {
  const parsed = parseBpiDashboardWorkbook(workbook, reportDate, sourceFileName);
  const sipCampaign = selectedCampaigns.find((campaign) => /^BPI SIP LOANS$/i.test(campaign.campaignName));
  const plCampaign = selectedCampaigns.find((campaign) => /^BPI PL$/i.test(campaign.campaignName));
  const recordMappings = new Map(parsed.records.map((record) => {
    const routedCampaign = /^PL\b/i.test(record.worksheetSource.trim()) ? plCampaign : sipCampaign;
    return [record, routedCampaign
      ? { campaign: routedCampaign, source: 'sheet' as const, evidence: record.worksheetSource }
      : mapWorksheetCampaign(`${record.category || ''} ${record.product || ''} ${record.metric} ${record.worksheetSource}`, selectedCampaigns)];
  }));
  const sheetMappings = new Map<string, { campaign: AssignedCampaign; source: 'sheet' | 'record' | 'selected' | 'unresolved' }>(parsed.sheets.map((sheet) => {
    const mappings = sheet.records.map((record) => recordMappings.get(record)!);
    const resolved = mappings.filter((mapping) => mapping.source !== 'unresolved');
    if (resolved.length) {
      const source = resolved.every((mapping) => mapping.source === 'selected')
        ? 'selected' as const
        : resolved.every((mapping) => mapping.source === 'sheet' && mapping.campaign.id === resolved[0].campaign.id)
          ? 'sheet' as const
          : 'record' as const;
      return [sheet.sheetName, { campaign: resolved[0].campaign, source }];
    }
    return [sheet.sheetName, mapWorksheetCampaign(sheet.sheetName, selectedCampaigns)];
  }));
  const seen = new Set<string>();
  let duplicateCount = 0;
  parsed.records = parsed.records.filter((record) => {
    const recordKey = bpiImportRecordIdentity(record);
    if (seen.has(recordKey)) { duplicateCount++; return false; }
    seen.add(recordKey);
    return true;
  });
  const retained = new Set(parsed.records);
  for (const sheet of parsed.sheets) sheet.records = sheet.records.filter((record) => retained.has(record));
  const previewRecords = parsed.records.map((record) => {
    const recordMapping = recordMappings.get(record)!;
    const sheetMapping = sheetMappings.get(record.worksheetSource)!;
    const mapping = recordMapping.source === 'sheet' || recordMapping.source === 'unresolved' ? recordMapping : sheetMapping;
    return {
      sheet: record.worksheetSource,
      campaignId: mapping.campaign?.id || '',
      campaignName: mapping.source === 'unresolved' ? 'Unmapped' : mapping.campaign.campaignName,
      agent: record.entityName || record.category || record.metric,
      reportPeriodType,
      reportDate: ymd(record.reportDate),
      metricType: record.metric,
      count: record.numericValue ?? (record.product === 'Count' ? record.actual ?? null : null),
      volume: record.product === 'Volume' ? record.actual ?? null : null,
      goal: record.target ?? null,
      actual: record.actual ?? null,
      achievement: record.achievement ?? null,
      status: mapping.source === 'unresolved' ? 'Unmapped' : 'New',
      validationMessage: mapping.source === 'unresolved' ? `No selected campaign matched section "${record.category || record.worksheetSource}".` : record.remark || '',
      row: record.sourceRow,
    };
  });
  const monthMap = new Map<string, any>();
  for (const record of parsed.records) {
    const month = `${record.year}-${String(record.month || 1).padStart(2, '0')}`;
    const current = monthMap.get(month) || { month, label: new Date(record.year, (record.month || 1) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), reportDate: `${month}-01`, new: 0, existing: 0, invalid: 0 };
    const mapping = recordMappings.get(record);
    if (mapping?.source === 'unresolved') current.invalid++;
    else current.new++;
    monthMap.set(month, current);
  }
  const worksheetPreviews = parsed.sheets.map((sheet, index) => {
    const mapping = sheetMappings.get(sheet.sheetName)!;
    const sheetRecords = parsed.records.filter((record) => record.worksheetSource === sheet.sheetName);
    const unmappedRecords = sheetRecords.filter((record) => recordMappings.get(record)?.source === 'unresolved').length;
    const mappedCampaigns = [...new Set(sheetRecords.map((record) => recordMappings.get(record)).filter((item) => item?.source !== 'unresolved').map((item) => item!.campaign.campaignName))];
    const warnings = [...sheet.warnings.map((warning) => warning.message)];
    if (unmappedRecords) warnings.unshift(`${unmappedRecords} record${unmappedRecords === 1 ? '' : 's'} could not be matched to the selected campaigns.`);
    return {
      key: `${index}:${sheet.sheetName}`,
      sheetName: sheet.sheetName,
      hidden: false,
      excluded: Boolean(sheet.excluded),
      selected: sheet.records.length > 0 && unmappedRecords === 0,
      format: sheet.excluded ? 'Excluded' : sheet.detectedType,
      campaignId: mapping.campaign?.id || '',
      campaignName: sheet.excluded ? 'Not applicable' : mapping.source === 'unresolved' ? 'Unmapped' : mapping.source === 'record' ? `Detected per record (${mappedCampaigns.join(', ')})` : mapping.campaign.campaignName,
      campaignMapping: mapping.source,
      metricType: 'all_metrics',
      metricSource: 'sheet' as const,
      reportDate: sheet.records[0] ? ymd(sheet.records[0].reportDate) : ymd(reportDate),
      totalRows: sheet.records.length + sheet.warnings.length,
      validRows: sheet.records.length,
      invalidRows: sheet.excluded ? 0 : sheet.warnings.filter((warning) => !/unsupported worksheet/i.test(warning.message)).length,
      duplicateRows: 0,
      unmappedRows: unmappedRecords,
      detectedMonths: sheet.months,
      detectedCampaigns: mappedCampaigns,
      detectedMetrics: [...new Set(sheetRecords.map((record) => record.metric))],
      warnings,
      errors: [] as string[],
      status: sheet.status,
    };
  });
  const unmappedRecords = previewRecords.filter((record) => record.status === 'Unmapped').length;
  return {
    parsed,
    recordMappings,
    previewRecords,
    worksheetPreviews,
    monthSummary: [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month)),
    workbookSummary: {
      totalWorksheets: workbook.SheetNames.length,
      worksheetsAccepted: worksheetPreviews.filter((sheet) => sheet.validRows > 0).length,
      worksheetsSkipped: worksheetPreviews.filter((sheet) => sheet.validRows === 0).length,
      totalValidRecords: parsed.records.length - unmappedRecords,
      totalInvalidRecords: parsed.issues.filter((issue) => !/unsupported worksheet|excluded by OpsView BPI import rules/i.test(issue.message)).length,
      totalDuplicateRecords: duplicateCount,
      inWorkbookDuplicateRecords: duplicateCount,
      totalUnmappedRecords: unmappedRecords,
      workbookYear: parsed.workbookYear,
      supportedWorksheets: parsed.sheets.filter((sheet) => sheet.detectedType !== 'Unsupported' && !sheet.excluded).map((sheet) => sheet.sheetName),
      unsupportedWorksheets: parsed.sheets.filter((sheet) => sheet.detectedType === 'Unsupported').map((sheet) => sheet.sheetName),
      excludedWorksheets: parsed.sheets.filter((sheet) => sheet.excluded).map((sheet) => sheet.sheetName),
      detectedMonths: parsed.detectedMonths,
      detectedCategories: parsed.detectedCategories,
      detectedMetrics: parsed.detectedMetrics,
      agentCount: parsed.agents.length,
      teamLeaderCount: 0,
      manpowerRecordCount: parsed.records.filter((record) => record.recordKind === 'manpower').length,
      campaignDistribution: selectedCampaigns.map((campaign) => {
        const campaignRecords = parsed.records.filter((record) => recordMappings.get(record)?.campaign.id === campaign.id && recordMappings.get(record)?.source !== 'unresolved');
        return {
          campaignId: campaign.id,
          campaignName: campaign.campaignName,
          worksheets: [...new Set(campaignRecords.map((record) => record.worksheetSource))],
          agents: new Set(campaignRecords.map((record) => record.entityName).filter(Boolean)).size,
          metrics: new Set(campaignRecords.map((record) => record.metric)).size,
          records: campaignRecords.length,
          months: [...new Set(campaignRecords.map((record) => dashboardMonthLabel(record.year, record.month!)))],
        };
      }).filter((item) => item.records > 0),
    },
  };
}

async function matchBdoAgents(preview: ReturnType<typeof buildBdoPreview>, campaignIds: string[]) {
  const exactNameSignature = (name: string) => normalizeAgentName(name).split(' ').filter(Boolean).sort().join('|');
  const agents = await prisma.user.findMany({
    where: {
      role: 'AGENT',
      OR: [
        { campaignId: { in: campaignIds } },
        { campaignAssignments: { some: { campaignId: { in: campaignIds } } } },
      ],
    },
    select: { id: true, name: true, campaignId: true, campaignAssignments: { select: { campaignId: true } } },
  });
  const byCampaignAndName = new Map<string, typeof agents[number]>();
  for (const agent of agents) {
    const assignedIds = new Set([agent.campaignId, ...agent.campaignAssignments.map((assignment) => assignment.campaignId)].filter(Boolean));
    for (const campaignId of assignedIds) byCampaignAndName.set(`${campaignId}|${exactNameSignature(agent.name)}`, agent);
  }
  const matched: any[] = [];
  const notFound: any[] = [];
  const seen = new Set<string>();
  for (const record of preview.parsed.records) {
    if (!record.entityName || !['agent_monitoring', 'scorecard'].includes(record.recordKind)) continue;
    const mapping = preview.recordMappings.get(record);
    if (!mapping || mapping.source === 'unresolved') continue;
    const key = `${mapping.campaign.id}|${exactNameSignature(record.entityName)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const agent = byCampaignAndName.get(key);
    const common = { name: record.entityName, count: 0, volume: 0, sheet: record.worksheetSource, campaignName: mapping.campaign.campaignName, row: record.sourceRow };
    if (agent) matched.push({ ...common, agentId: agent.id, agentName: agent.name });
    else notFound.push(common);
  }
  return { matched, notFound };
}

async function markExistingBdoRecords(preview: ReturnType<typeof buildBdoPreview>, selectedCampaignIds: string[], reportPeriodType: ReportPeriodType) {
  if (!preview.parsed.records.length) return;
  const years = [...new Set(preview.parsed.records.map((record) => record.year))];
  const existing = await prisma.$queryRaw<Array<{ campaignId: string; worksheetSource: string; recordKind: string; entityName: string; category: string; product: string; metric: string; year: number; month: number | null }>>`
    SELECT "campaignId", "worksheetSource", "recordKind", "entityName", "category", "product", "metric", "year", "month"
    FROM "DashboardImportRecord"
    WHERE "campaignId" = ANY(${selectedCampaignIds}::text[]) AND "reportPeriodType" = ${reportPeriodType} AND "year" = ANY(${years}::int[])
  `;
  const existingKeys = new Set(existing.map((record) => `${record.campaignId}|${[record.worksheetSource, record.recordKind, record.entityName, record.category, record.product, record.metric, record.year, record.month || 0].map((value) => String(value).trim().toLowerCase()).join('|')}`));
  let count = 0;
  preview.parsed.records.forEach((record, index) => {
    const sheet = preview.worksheetPreviews.find((candidate) => candidate.sheetName === record.worksheetSource);
    if (!sheet || sheet.campaignMapping === 'unresolved' || !existingKeys.has(`${preview.previewRecords[index].campaignId}|${bdoNaturalKey(record)}`)) return;
    preview.previewRecords[index].status = 'Existing';
    count++;
  });
  preview.workbookSummary.totalDuplicateRecords += count;
  for (const summary of preview.monthSummary) {
    const existingInMonth = preview.previewRecords.filter((record) => record.reportDate.startsWith(summary.month) && record.status === 'Existing').length;
    summary.existing = existingInMonth;
    summary.new -= existingInMonth;
  }
}

async function persistBdoImport({
  preview, selectedCampaigns, campaignMappings, fileName, importMode, duplicateMode, reportPeriodType, reportDate, importedById, selectedWorksheetKeys, skipUnresolvedRecordMappings = false,
}: {
  preview: ReturnType<typeof buildBdoPreview>;
  selectedCampaigns: AssignedCampaign[];
  campaignMappings: WorksheetCampaignMappings;
  fileName: string;
  importMode: string;
  duplicateMode: DuplicateMode;
  reportPeriodType: ReportPeriodType;
  reportDate: Date;
  importedById: string;
  selectedWorksheetKeys: string[];
  skipUnresolvedRecordMappings?: boolean;
}) {
  const selectedSheets = preview.worksheetPreviews.filter((sheet) => selectedWorksheetKeys.includes(sheet.key));
  const campaignIdsBySheet = new Map(selectedSheets.map((sheet) => [
    sheet.sheetName,
    campaignMappings[sheet.key]?.length
      ? campaignMappings[sheet.key]
      : sheet.campaignMapping === 'unresolved'
        ? []
        : [sheet.campaignId],
  ]));
  const explicitCampaignIdsBySheet = new Map(selectedSheets.map((sheet) => [sheet.sheetName, campaignMappings[sheet.key] || []]));
  const records = preview.parsed.records
    .flatMap((record) => {
      if (!campaignIdsBySheet.has(record.worksheetSource)) return [];
      const explicitIds = explicitCampaignIdsBySheet.get(record.worksheetSource) || [];
      const detected = preview.recordMappings.get(record);
      const detectedId = detected?.source !== 'unresolved' ? detected?.campaign.id : '';

      // Multiple worksheet selections are an allow-list, not an instruction to
      // clone every row into every campaign. Keep record-level detection when
      // possible; a single explicit campaign remains the manual fallback.
      if (explicitIds.length > 1) {
        return detectedId && explicitIds.includes(detectedId) ? [{ record, campaignId: detectedId }] : [];
      }
      if (explicitIds.length === 1) return [{ record, campaignId: explicitIds[0] }];
      if (detectedId) return [{ record, campaignId: detectedId }];
      if (skipUnresolvedRecordMappings) return [];
      const fallbackIds = campaignIdsBySheet.get(record.worksheetSource) || [];
      return fallbackIds.length === 1 ? [{ record, campaignId: fallbackIds[0] }] : [];
    });
  const importedCampaignIds = [...new Set(records.map((item) => item.campaignId))];
  return prisma.$transaction(async (tx) => {
    const batchId = crypto.randomUUID();
    const selectedCampaignIds = selectedCampaigns.map((campaign) => campaign.id).join(',');
    const detectedWorksheets = preview.worksheetPreviews.map((sheet) => sheet.sheetName).join(', ');
    const unmappedCount = Number((preview.workbookSummary as any).totalUnmappedRecords || 0);
    await tx.$executeRaw`
      INSERT INTO "DashboardImportBatch" ("id", "campaignId", "fileName", "importMode", "duplicateMode", "reportPeriodType", "reportDate", "workbookYear", "totalWorksheets", "supportedSheets", "selectedCampaignIds", "detectedWorksheets", "unmappedCount", "importedById", "status")
      VALUES (${batchId}, ${importedCampaignIds[0] || selectedCampaigns[0].id}, ${fileName}, ${importMode}, ${duplicateMode}, ${reportPeriodType}, ${reportDate}, ${preview.parsed.workbookYear}, ${preview.workbookSummary.totalWorksheets}, ${preview.workbookSummary.worksheetsAccepted}, ${selectedCampaignIds}, ${detectedWorksheets}, ${unmappedCount}, ${importedById}, 'PROCESSING')
    `;
    let inserted = 0; let updated = 0; let skipped = preview.workbookSummary.inWorkbookDuplicateRecords;
    if (duplicateMode === 'replace_period') {
      const periods = new Set(records.map(({ record, campaignId }) => `${campaignId}|${record.worksheetSource}|${record.year}|${record.month || 0}`));
      for (const period of periods) {
        const [campaignId, worksheet, year, month] = period.split('|');
        await tx.$executeRaw`DELETE FROM "DashboardImportRecord" WHERE "campaignId" = ${campaignId} AND "worksheetSource" = ${worksheet} AND "year" = ${Number(year)} AND COALESCE("month", 0) = ${Number(month)} AND "reportPeriodType" = ${reportPeriodType}`;
      }
    }
    type ExistingDashboardRecord = DashboardNaturalKeyRecord & { id: string; campaignId: string };
    const existingRows = importedCampaignIds.length
      ? await tx.$queryRaw<ExistingDashboardRecord[]>(Prisma.sql`
          SELECT "id", "campaignId", "worksheetSource", "recordKind", "entityName", "category", "product", "metric", "year", "month"
          FROM "DashboardImportRecord"
          WHERE "campaignId" IN (${Prisma.join(importedCampaignIds)}) AND "reportPeriodType" = ${reportPeriodType}
        `)
      : [];
    const existingByKey = new Map(existingRows.map((row) => [dashboardImportNaturalKey(row.campaignId, row), row.id]));
    const pendingInserts: typeof records = [];

    for (const item of records) {
      const existingId = existingByKey.get(dashboardImportNaturalKey(item.campaignId, item.record));
      if (!existingId) {
        pendingInserts.push(item);
        continue;
      }
      if (duplicateMode === 'skip') {
        skipped++;
        continue;
      }
      const { record } = item;
      await tx.$executeRaw`
        UPDATE "DashboardImportRecord" SET "batchId" = ${batchId}, "sourceRow" = ${record.sourceRow}, "monitoringType" = ${record.monitoringType || null}, "level" = ${record.level || null},
          "reportDate" = ${record.reportDate}, "target" = ${record.target ?? null}, "actual" = ${record.actual ?? null}, "achievement" = ${record.achievement ?? null},
          "numericValue" = ${record.numericValue ?? null}, "declaredSeat" = ${record.declaredSeat ?? null}, "actualHeadCount" = ${record.actualHeadCount ?? null},
          "dateHired" = ${record.dateHired ?? null}, "dataStatus" = ${record.dataStatus || null}, "remark" = ${record.remark || null}, "sourceFile" = ${fileName}, "importedById" = ${importedById}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${existingId}
      `;
      updated++;
    }

    // Large dashboard workbooks can contain thousands of records. Insert them
    // in bounded batches and let the natural key reject concurrent duplicates,
    // keeping existing data intact while adding only genuinely new records.
    for (const chunk of inChunks(pendingInserts, 200)) {
      const values = chunk.map(({ record, campaignId }) => Prisma.sql`(
        ${crypto.randomUUID()}, ${batchId}, ${campaignId}, ${record.worksheetSource}, ${record.sourceRow}, ${record.recordKind},
        ${record.monitoringType || null}, ${record.entityName || ''}, ${record.level || null}, ${record.category || ''}, ${record.product || ''},
        ${record.metric}, ${record.month || 0}, ${record.year}, ${reportPeriodType}, ${record.reportDate}, ${record.target ?? null},
        ${record.actual ?? null}, ${record.achievement ?? null}, ${record.numericValue ?? null}, ${record.declaredSeat ?? null},
        ${record.actualHeadCount ?? null}, ${record.dateHired ?? null}, ${record.dataStatus || null}, ${record.remark || null}, ${fileName}, ${importedById}
      )`);
      inserted += await tx.$executeRaw(Prisma.sql`
        INSERT INTO "DashboardImportRecord" ("id", "batchId", "campaignId", "worksheetSource", "sourceRow", "recordKind", "monitoringType", "entityName", "level", "category", "product", "metric", "month", "year", "reportPeriodType", "reportDate", "target", "actual", "achievement", "numericValue", "declaredSeat", "actualHeadCount", "dateHired", "dataStatus", "remark", "sourceFile", "importedById")
        VALUES ${Prisma.join(values)}
        ON CONFLICT ("campaignId", "worksheetSource", "recordKind", "entityName", "category", "product", "metric", "year", "month", "reportPeriodType") DO NOTHING
      `);
    }
    skipped += Math.max(0, pendingInserts.length - inserted);

    const issues = preview.parsed.issues.slice(0, 2000);
    for (const chunk of inChunks(issues, 250)) {
      const values = chunk.map((issue) => Prisma.sql`(${crypto.randomUUID()}, ${batchId}, ${issue.worksheet}, ${issue.row || null}, ${issue.message}, ${issue.rawValue || null})`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "DashboardImportIssue" ("id", "batchId", "worksheetSource", "sourceRow", "message", "rawValue")
        VALUES ${Prisma.join(values)}
      `);
    }
    const actionableIssues = preview.parsed.issues.filter((issue) => !/unsupported worksheet|excluded by OpsView BPI import rules/i.test(issue.message));
    const invalidIssues = actionableIssues.filter((issue) => /invalid numeric|formula returned|text value skipped|no valid|not found|malformed/i.test(issue.message));
    const invalid = invalidIssues.length;
    const invalidIssueSet = new Set(invalidIssues);
    const breakdown = {
      ciProduction: records.filter(({ record }) => record.monitoringType === 'CI_AGENT').length,
      crossSellProduction: records.filter(({ record }) => record.monitoringType === 'CROSS_SELL_AGENT').length,
      ciScorecard: records.filter(({ record }) => record.recordKind === 'scorecard').length,
      ciHoh: records.filter(({ record }) => record.monitoringType === 'CI_HOH').length,
      crossSellHoh: records.filter(({ record }) => record.monitoringType === 'CROSS_SELL_HOH').length,
      ytdPerformance: records.filter(({ record }) => record.recordKind === 'ytd').length,
    };
    const completedStatus = actionableIssues.length > 0 ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED';
    await tx.$executeRaw`UPDATE "DashboardImportBatch" SET "insertedCount" = ${inserted}, "updatedCount" = ${updated}, "skippedCount" = ${skipped}, "duplicateCount" = ${skipped}, "failedCount" = ${invalid}, "status" = ${completedStatus}, "completedAt" = CURRENT_TIMESTAMP WHERE "id" = ${batchId}`;
    console.info('BDO dashboard import batch committed', { batchId, fileName, inserted, updated, skipped, warnings: actionableIssues.length - invalid, errors: invalid });
    return {
      batchId, inserted, updated, skipped, invalid, breakdown, importedCampaignIds, importedCampaigns: importedCampaignIds.length,
      success: inserted + updated, created: 0, details: [],
      warnings: actionableIssues.filter((issue) => !invalidIssueSet.has(issue)).slice(0, 200).map((issue) => `${issue.worksheet}${issue.row ? ` row ${issue.row}` : ''}: ${issue.message}`),
      errors: invalidIssues.slice(0, 50).map((issue) => `${issue.worksheet}${issue.row ? ` row ${issue.row}` : ''}: ${issue.message}`),
      message: `Import completed for ${importedCampaignIds.length} campaign${importedCampaignIds.length === 1 ? '' : 's'}: ${inserted} inserted, ${updated} updated, ${skipped} skipped, and ${invalid} invalid.`,
    };
  }, { timeout: 120000 });
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user?.role !== 'COLLECTOR') {
      return NextResponse.json({ error: 'Only collectors can view bulk imports' }, { status: 403 });
    }

    await ensureImportMetadataColumns();

    const { searchParams } = new URL(req.url);
    const entryId = searchParams.get('entryId');

    if (entryId) {
      const summary = await getImportSummary(entryId, user.id);
      if (!summary) {
        const dashboardBatches = await prisma.$queryRaw<any[]>`
          SELECT b.*, COALESCE((SELECT STRING_AGG(c2."campaignName", ', ' ORDER BY c2."campaignName") FROM "Campaign" c2 WHERE c2.id = ANY(STRING_TO_ARRAY(b."selectedCampaignIds", ','))), c."campaignName") AS "campaignName", COUNT(r.id)::int AS "detailCount"
          FROM "DashboardImportBatch" b
          JOIN "Campaign" c ON c.id = b."campaignId"
          LEFT JOIN "DashboardImportRecord" r ON r."batchId" = b.id
          WHERE b.id = ${entryId} AND b."importedById" = ${user.id}
          GROUP BY b.id, c."campaignName"
          LIMIT 1
        `;
        const batch = dashboardBatches[0];
        if (batch) {
          const issues = await prisma.dashboardImportIssue.findMany({
            where: { batchId: batch.id },
            orderBy: [{ worksheetSource: 'asc' }, { sourceRow: 'asc' }],
            take: 200,
          });
          return NextResponse.json({ importFile: {
            id: batch.id,
            campaignId: batch.campaignId,
            campaignName: batch.campaignName,
            fileName: batch.fileName,
            metricType: 'all_metrics',
            reportDate: batch.reportDate,
            importedAt: batch.createdAt,
            detailCount: Number(batch.detailCount || 0),
            totals: { transmittals: 0, approvals: 0, booked: 0, volume: 0, ntb: 0, supplementary: 0 },
            details: [],
            sourceKind: 'dashboard',
            status: batch.status,
            deletable: true,
            batchStats: {
              detected: Number(batch.insertedCount || 0) + Number(batch.updatedCount || 0) + Number(batch.skippedCount || 0) + Number(batch.failedCount || 0),
              imported: Number(batch.insertedCount || 0),
              updated: Number(batch.updatedCount || 0),
              unchanged: 0,
              skipped: Number(batch.skippedCount || 0),
              warnings: issues.length,
              errors: Number(batch.failedCount || 0),
            },
            issues: issues.map((issue) => ({ id: issue.id, level: 'WARNING', code: 'BPI_DATA_QUALITY', message: issue.message, sourceSheet: issue.worksheetSource, sourceRow: issue.sourceRow })),
          } });
        }

        const productionBatch = await prisma.productionImport.findFirst({
          where: { id: entryId, importedById: user.id },
          include: {
            issues: { orderBy: { createdAt: 'asc' }, take: 100 },
            productionRecords: {
              distinct: ['campaignId'],
              select: { campaign: { select: { campaignName: true } } },
              orderBy: { campaignId: 'asc' },
            },
          },
        });
        if (productionBatch) {
          const periods = await prisma.productionMonitoring.aggregate({
            where: { productionImportId: productionBatch.id },
            _min: { reportPeriod: true },
            _max: { reportPeriod: true },
          });
          const campaignNames = [...new Set(productionBatch.productionRecords.map((record) => record.campaign.campaignName))]
            .sort((a, b) => a.localeCompare(b));
          return NextResponse.json({
            importFile: {
              id: productionBatch.id,
              campaignName: campaignNames.join(', ') || 'Production Monitoring',
              fileName: productionBatch.fileName,
              metricType: 'production_monitoring',
              reportDate: periods._max.reportPeriod || productionBatch.createdAt,
              periodStart: periods._min.reportPeriod,
              periodEnd: periods._max.reportPeriod,
              importedAt: productionBatch.createdAt,
              detailCount: productionBatch.recordsImported + productionBatch.recordsUpdated + productionBatch.recordsUnchanged,
              totals: { transmittals: 0, approvals: 0, booked: 0, volume: 0, ntb: 0, supplementary: 0 },
              details: [],
              sourceKind: 'production_monitoring',
              status: productionBatch.status,
              deletable: false,
              batchStats: {
                detected: productionBatch.recordsDetected,
                imported: productionBatch.recordsImported,
                updated: productionBatch.recordsUpdated,
                unchanged: productionBatch.recordsUnchanged,
                skipped: productionBatch.recordsSkipped,
                warnings: productionBatch.warningCount,
                errors: productionBatch.errorCount,
              },
              issues: productionBatch.issues.map((issue) => ({ id: issue.id, level: issue.level, code: issue.code, message: issue.message, sourceSheet: issue.sourceSheet, sourceRow: issue.sourceRow })),
            },
          });
        }

        const kpiBatch = await prisma.kpiImportBatch.findFirst({
          where: { id: entryId, uploadedById: user.id },
          include: {
            campaign: { select: { campaignName: true } },
            issues: { orderBy: { createdAt: 'asc' }, take: 100 },
          },
        });
        if (kpiBatch) {
          return NextResponse.json({
            importFile: {
              id: kpiBatch.id,
              campaignId: kpiBatch.campaignId,
              campaignName: kpiBatch.campaign.campaignName,
              fileName: kpiBatch.originalFileName,
              metricType: 'kpi_workbook',
              reportDate: kpiBatch.periodEnd || kpiBatch.periodStart || kpiBatch.createdAt,
              periodStart: kpiBatch.periodStart,
              periodEnd: kpiBatch.periodEnd,
              importedAt: kpiBatch.createdAt,
              detailCount: kpiBatch.successfulRows + kpiBatch.updatedRows,
              totals: { transmittals: 0, approvals: 0, booked: 0, volume: 0, ntb: 0, supplementary: 0 },
              details: [],
              sourceKind: 'kpi',
              status: kpiBatch.status,
              deletable: false,
              batchStats: {
                detected: kpiBatch.totalRows,
                imported: kpiBatch.successfulRows,
                updated: kpiBatch.updatedRows,
                unchanged: 0,
                skipped: kpiBatch.skippedRows,
                warnings: kpiBatch.warningRows,
                errors: kpiBatch.failedRows,
              },
              issues: kpiBatch.issues.map((issue) => ({ id: issue.id, level: issue.kind, code: issue.kind, message: issue.message, sourceSheet: issue.sourceSheet, sourceRow: issue.sourceRow })),
            },
          });
        }

        return NextResponse.json({ error: 'Import file not found' }, { status: 404 });
      }

      const details = await prisma.productionDetail.findMany({
        where: { productionEntryId: entryId },
        select: {
          id: true,
          transmittals: true,
          approvals: true,
          booked: true,
          volume: true,
          ntb: true,
          supplementary: true,
          seatCategory: true,
          cardLevel: true,
          cardLevelLabel: true,
          cardLevelGrandTotal: true,
          agent: { select: { name: true, seatNumber: true } },
        },
        orderBy: { agent: { name: 'asc' } },
      });

      return NextResponse.json({
        importFile: {
          ...summary,
          details: details.map((detail) => ({
            id: detail.id,
            agent: detail.agent.name,
            seatNumber: detail.agent.seatNumber,
            transmittals: Number(detail.transmittals || 0),
            approvals: Number(detail.approvals || 0),
            booked: Number(detail.booked || 0),
            volume: Number(detail.volume || 0),
            ntb: Number(detail.ntb || 0),
            supplementary: Number(detail.supplementary || 0),
            seatCategory: detail.seatCategory,
            cardLevel: detail.cardLevel,
            cardLevelLabel: detail.cardLevelLabel,
            grandTotal: detail.cardLevelGrandTotal == null ? null : Number(detail.cardLevelGrandTotal),
          })),
        },
      });
    }

    const rows = await prisma.$queryRaw<any[]>`
      SELECT pe.id,
             pe."campaignId",
             c."campaignName",
             pe.date,
             pe.time,
             pe."periodStart",
             pe."periodEnd",
             pe."reportPeriodType",
             pe."importAuditLog",
             pe."createdAt",
             pe."importFileName",
             pe."importMetricType",
             COUNT(pd.id) AS "detailCount",
             COALESCE(SUM(pd.transmittals), 0) AS transmittals,
             COALESCE(SUM(pd.approvals), 0) AS approvals,
             COALESCE(SUM(pd.booked), 0) AS booked,
             COALESCE(SUM(pd.volume), 0) AS volume,
             COALESCE(SUM(pd.ntb), 0) AS ntb,
             COALESCE(SUM(pd.supplementary), 0) AS supplementary
      FROM "ProductionEntry" pe
      JOIN "Campaign" c ON c.id = pe."campaignId"
      LEFT JOIN "ProductionDetail" pd ON pd."productionEntryId" = pe.id
      WHERE pe."createdBy" = ${user.id}
      GROUP BY pe.id, c."campaignName"
      ORDER BY pe."createdAt" DESC
      LIMIT 50
    `;
    const dashboardRows = await prisma.$queryRaw<any[]>`
      SELECT b.id, b."campaignId", COALESCE((SELECT STRING_AGG(c2."campaignName", ', ' ORDER BY c2."campaignName") FROM "Campaign" c2 WHERE c2.id = ANY(STRING_TO_ARRAY(b."selectedCampaignIds", ','))), c."campaignName") AS "campaignName", b."fileName", b."reportDate", b."createdAt", b.status, b."insertedCount", b."updatedCount", b."skippedCount", b."failedCount", (b."insertedCount" + b."updatedCount") AS "detailCount"
      FROM "DashboardImportBatch" b
      JOIN "Campaign" c ON c.id = b."campaignId"
      WHERE b."importedById" = ${user.id} AND b.status LIKE 'COMPLETED%'
      ORDER BY b."createdAt" DESC
      LIMIT 50
    `;
    const productionRows = await prisma.$queryRaw<any[]>`
      SELECT pi.id,
             pi."fileName",
             pi.status,
             pi."createdAt",
             pi."recordsDetected",
             pi."recordsImported",
             pi."recordsUpdated",
             pi."recordsUnchanged",
             pi."recordsSkipped",
             pi."warningCount",
             pi."errorCount",
             STRING_AGG(DISTINCT c."campaignName", ', ' ORDER BY c."campaignName") AS "campaignName",
             MIN(pm."reportPeriod") AS "periodStart",
             MAX(pm."reportPeriod") AS "periodEnd"
      FROM "ProductionImport" pi
      LEFT JOIN "ProductionMonitoring" pm ON pm."productionImportId" = pi.id
      LEFT JOIN "Campaign" c ON c.id = pm."campaignId"
      WHERE pi."importedById" = ${user.id} AND pi.status LIKE 'COMPLETED%'
      GROUP BY pi.id
      ORDER BY pi."createdAt" DESC
      LIMIT 50
    `;
    const kpiRows = await prisma.kpiImportBatch.findMany({
      where: { uploadedById: user.id, status: { startsWith: 'COMPLETED' } },
      include: { campaign: { select: { campaignName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const emptyTotals = { transmittals: 0, approvals: 0, booked: 0, volume: 0, ntb: 0, supplementary: 0 };
    const legacyImports = rows.map((row) => ({ ...formatImportSummary(row), sourceKind: 'production_entry', deletable: true }));
    const dashboardImports = dashboardRows.map((batch) => ({
      id: batch.id,
      campaignId: batch.campaignId,
      campaignName: batch.campaignName,
      fileName: batch.fileName,
      metricType: 'all_metrics',
      reportDate: batch.reportDate,
      importedAt: batch.createdAt,
      detailCount: Number(batch.detailCount || 0),
      totals: emptyTotals,
      sourceKind: 'dashboard',
      status: batch.status,
      deletable: true,
      batchStats: {
        detected: Number(batch.insertedCount || 0) + Number(batch.updatedCount || 0) + Number(batch.skippedCount || 0) + Number(batch.failedCount || 0),
        imported: Number(batch.insertedCount || 0),
        updated: Number(batch.updatedCount || 0),
        unchanged: 0,
        skipped: Number(batch.skippedCount || 0),
        warnings: Number(batch.failedCount || 0),
        errors: Number(batch.failedCount || 0),
      },
    }));
    const productionImports = productionRows.map((batch) => ({
      id: batch.id,
      campaignName: batch.campaignName || 'Production Monitoring',
      fileName: batch.fileName,
      metricType: 'production_monitoring',
      reportDate: batch.periodEnd || batch.createdAt,
      periodStart: batch.periodStart,
      periodEnd: batch.periodEnd,
      importedAt: batch.createdAt,
      detailCount: Number(batch.recordsImported || 0) + Number(batch.recordsUpdated || 0) + Number(batch.recordsUnchanged || 0),
      totals: emptyTotals,
      sourceKind: 'production_monitoring',
      status: batch.status,
      deletable: false,
      batchStats: {
        detected: Number(batch.recordsDetected || 0),
        imported: Number(batch.recordsImported || 0),
        updated: Number(batch.recordsUpdated || 0),
        unchanged: Number(batch.recordsUnchanged || 0),
        skipped: Number(batch.recordsSkipped || 0),
        warnings: Number(batch.warningCount || 0),
        errors: Number(batch.errorCount || 0),
      },
    }));
    const kpiImports = kpiRows.map((batch) => ({
      id: batch.id,
      campaignId: batch.campaignId,
      campaignName: batch.campaign.campaignName,
      fileName: batch.originalFileName,
      metricType: 'kpi_workbook',
      reportDate: batch.periodEnd || batch.periodStart || batch.createdAt,
      periodStart: batch.periodStart,
      periodEnd: batch.periodEnd,
      importedAt: batch.createdAt,
      detailCount: batch.successfulRows + batch.updatedRows,
      totals: emptyTotals,
      sourceKind: 'kpi',
      status: batch.status,
      deletable: false,
      batchStats: {
        detected: batch.totalRows,
        imported: batch.successfulRows,
        updated: batch.updatedRows,
        unchanged: 0,
        skipped: batch.skippedRows,
        warnings: batch.warningRows,
        errors: batch.failedRows,
      },
    }));
    const imports = [...legacyImports, ...dashboardImports, ...productionImports, ...kpiImports]
      .sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())
      .slice(0, 50);
    const campaigns = (await getAssignedCampaigns(user.id, user.campaignId))
      .sort((a, b) => a.campaignName.localeCompare(b.campaignName));
    return NextResponse.json({ imports, campaigns });
  } catch (error) {
    console.error('Bulk import history error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user?.role !== 'COLLECTOR') {
      return NextResponse.json({ error: 'Only collectors can bulk import' }, { status: 403 });
    }

    const collectorUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { id: true, campaignId: true },
    });

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const mode = (formData.get('mode') as string) || 'import';
    const importMode = (formData.get('importMode') as string) || 'single';
    const requestedMetricType = (formData.get('metricType') as string) || 'transmittals';
    let reportPeriodType = ((formData.get('reportPeriodType') as string) || 'daily') as ReportPeriodType;
    const duplicateMode = ((formData.get('duplicateMode') as string) || 'skip') as DuplicateMode;
    const reportMonthValue = Number(formData.get('reportMonth') || 0);
    const reportYearValue = Number(formData.get('reportYear') || 0);
    const reportDateStr = formData.get('reportDate') as string;
    const periodStartStr = (formData.get('periodStart') as string) || '';
    const periodEndStr = (formData.get('periodEnd') as string) || '';
    const legacyCampaignId = (formData.get('campaignId') as string) || '';
    let submittedCampaignIds: string[] = [];
    try {
      const parsed = JSON.parse((formData.get('campaignIds') as string) || '[]');
      if (Array.isArray(parsed)) submittedCampaignIds = [...new Set(parsed.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())))];
    } catch {
      return NextResponse.json({ error: 'The selected campaign list is invalid.' }, { status: 400 });
    }
    if (!submittedCampaignIds.length && legacyCampaignId) submittedCampaignIds = [legacyCampaignId];

    if (!['all', 'worksheets', 'single'].includes(importMode)) {
      return NextResponse.json({ error: 'Import Mode must be Import All Data, Import Selected Worksheets, or Import Single Metric.' }, { status: 400 });
    }
    if ((importMode === 'all' || importMode === 'worksheets') && requestedMetricType !== 'all') {
      return NextResponse.json({ error: 'Import All Data requires Metric Type to be ALL METRICS.' }, { status: 400 });
    }
    if (importMode === 'single' && ['all', 'all_metrics'].includes(requestedMetricType)) {
      return NextResponse.json({ error: 'Import Single Metric requires an individual Metric Type.' }, { status: 400 });
    }
    if (!['daily', 'monthly', 'yearly'].includes(reportPeriodType)) {
      return NextResponse.json({ error: 'Report Period must be Daily, Monthly, or Yearly.' }, { status: 400 });
    }
    if (!['skip', 'update', 'replace_period'].includes(duplicateMode)) {
      return NextResponse.json({ error: 'Duplicate handling must be Skip Existing, Update Existing, or Replace Matching Period Data.' }, { status: 400 });
    }
    const metricType = requestedMetricType === 'all' ? 'all_metrics' : requestedMetricType;

    await ensureImportMetadataColumns();

    const assignedCampaigns = await getAssignedCampaigns(user.id, collectorUser?.campaignId);
    const selectedCampaigns = submittedCampaignIds
      .map((id) => assignedCampaigns.find((campaign) => campaign.id === id))
      .filter((campaign): campaign is AssignedCampaign => Boolean(campaign));
    if (selectedCampaigns.length !== submittedCampaignIds.length) {
      return NextResponse.json({ error: 'One or more selected campaigns are invalid or inactive.' }, { status: 400 });
    }

    // Resolve the target campaign: prefer the one chosen on the import page,
    // otherwise fall back to the collector's assigned campaign.
    const effectiveCampaignId = selectedCampaigns[0]?.id || '';
    const campaignExists = selectedCampaigns[0];
    const campaignName = campaignExists?.campaignName || '';
    let campaignAgents = effectiveCampaignId
      ? await prisma.user.findMany({
          where: { campaignId: effectiveCampaignId, role: 'AGENT' },
          select: { id: true, name: true },
        })
      : [];
    const findExistingAgent = (importedName: string) =>
      campaignAgents.find((agent) => agentNameMatches(agent.name, importedName)) || null;
    const rememberAgent = (agent: { id: string; name: string }) => {
      if (!campaignAgents.some((existing) => existing.id === agent.id)) campaignAgents.push(agent);
    };

    // If the collector has no campaign assigned yet, bind them to the one they
    // are importing into. Without this, their dashboard (which keys off the
    // collector's own campaign) would never show the imported agents.
    if (mode !== 'preview' && effectiveCampaignId) {
      if (!collectorUser?.campaignId) {
        await prisma.user.update({
          where: { id: user.id },
          data: { campaignId: effectiveCampaignId },
        });
      }
      await prisma.userCampaign.upsert({
        where: {
          userId_campaignId: {
            userId: user.id,
            campaignId: effectiveCampaignId,
          },
        },
        update: {},
        create: {
          userId: user.id,
          campaignId: effectiveCampaignId,
        },
      });
    }

    let reportDate: Date;
    if (reportPeriodType === 'daily') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDateStr || '')) return NextResponse.json({ error: 'Daily reporting requires a valid complete Report Date.' }, { status: 400 });
      const [year, month, day] = reportDateStr.split('-').map(Number);
      reportDate = new Date(year, month - 1, day);
      if (reportDate.getFullYear() !== year || reportDate.getMonth() !== month - 1 || reportDate.getDate() !== day) return NextResponse.json({ error: 'Daily Report Date is invalid.' }, { status: 400 });
    } else if (reportPeriodType === 'monthly') {
      if (!Number.isInteger(reportMonthValue) || reportMonthValue < 1 || reportMonthValue > 12 || !Number.isInteger(reportYearValue) || reportYearValue < 2000 || reportYearValue > 2100) return NextResponse.json({ error: 'Monthly reporting requires a valid Report Month and Report Year.' }, { status: 400 });
      reportDate = new Date(reportYearValue, reportMonthValue - 1, 1);
    } else {
      if (!Number.isInteger(reportYearValue) || reportYearValue < 2000 || reportYearValue > 2100) return NextResponse.json({ error: 'Yearly reporting requires a valid Report Year.' }, { status: 400 });
      reportDate = new Date(reportYearValue, 0, 1);
    }

    // MTD reporting period detected from the file (YYYY-MM-DD). Persisted on the
    // production entry so the imported batch carries its full range, not just a day.
    const parseYmd = (s: string): Date | null => {
      if (!s) return null;
      const [y, m, d] = s.split('-').map(Number);
      if (!y || !m || !d) return null;
      return new Date(y, m - 1, d);
    };
    const periodStart = parseYmd(periodStartStr);
    const periodEnd = parseYmd(periodEndStr);

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'File is too large. Maximum upload size is 10 MB.' }, { status: 400 });
    }

    const lowerFileName = file.name.toLowerCase();
    const excelExtension = /\.(xlsx|xls)$/i.test(lowerFileName);
    const csvExtension = lowerFileName.endsWith('.csv');
    const neutralMime = !file.type || file.type === 'application/octet-stream';
    const excelMime = neutralMime || file.type.includes('spreadsheet') || file.type.includes('excel') || file.type === 'application/vnd.ms-office';
    const csvMime = neutralMime || file.type.includes('csv') || file.type === 'text/plain';
    if ((excelExtension && !excelMime) || (csvExtension && !csvMime)) {
      return NextResponse.json({ error: 'The file extension and content type do not match.' }, { status: 400 });
    }
    const isExcel = excelExtension && excelMime;
    const isCsv = csvExtension && csvMime;
    if (isExcel) {
      const fileBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(fileBuffer);
      const isZipWorkbook = bytes[0] === 0x50 && bytes[1] === 0x4b;
      const isLegacyWorkbook = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
      if (!isZipWorkbook && !isLegacyWorkbook) {
        return NextResponse.json({ error: 'The uploaded file is not a valid Excel workbook.' }, { status: 400 });
      }

      let workbook: XLSX.WorkBook;
      try {
        workbook = XLSX.read(bytes, { type: 'array', cellDates: true, cellFormula: true });
      } catch {
        return NextResponse.json({ error: 'The workbook is corrupted, unreadable, or password-protected.' }, { status: 400 });
      }
      if (!workbook.SheetNames.length) {
        return NextResponse.json({ error: 'No worksheets found in Excel file' }, { status: 400 });
      }

      // KPI workbooks use one worksheet per month and a two-level
      // Actuals/Goal header. Detect this before the production parsers so the
      // same Bulk Import screen can read the complete cross-month workbook and
      // persist it to the KPI monitoring records.
      const kpiParsed = parseKpiWorkbook(
        Buffer.from(bytes),
        file.name,
        reportYearValue || reportDate.getFullYear(),
      );
      const isKpiWorkbook = kpiParsed.worksheets.some(
        (sheet) => sheet.supported && !sheet.error && sheet.recordCount > 0
      );
      if (isKpiWorkbook) {
        // This workbook layout is the BDO CCC Actuals / Goal / ACVT report.
        // Resolve it to the collector's assigned BDO CCC campaign instead of
        // silently using their legacy/default primary campaign.
        const selectedBdoCccCampaign = selectedCampaigns.find((campaign) =>
          BDO_CCC_CAMPAIGN_PATTERN.test(campaign.campaignName.trim())
        );
        const assignedBdoCccCampaigns = assignedCampaigns.filter((campaign) =>
          BDO_CCC_CAMPAIGN_PATTERN.test(campaign.campaignName.trim())
        );
        const kpiCampaign = selectedBdoCccCampaign ?? (
          assignedBdoCccCampaigns.length === 1 ? assignedBdoCccCampaigns[0] : null
        );
        if (!kpiCampaign) {
          return NextResponse.json({
            error: 'Assign or select exactly one BDO CCC campaign before importing this KPI workbook.',
          }, { status: 400 });
        }
        if (mode === 'preview') {
          return NextResponse.json(await buildKpiBulkPreview(kpiParsed, kpiCampaign));
        }
        const selectedWorksheetKeysValue = formData.get('selectedWorksheetKeys');
        const selectedWorksheetKeys: string[] = selectedWorksheetKeysValue === null
          ? kpiParsed.worksheets.filter((sheet) => sheet.supported && !sheet.error && sheet.recordCount > 0).map((sheet) => `kpi::${sheet.name}`)
          : JSON.parse(String(selectedWorksheetKeysValue || '[]'));
        const confirmedNewAgents: string[] = JSON.parse(
          String(formData.get('confirmedNewAgents') || '[]')
        );
        const result = await persistKpiBulkImport({
          parsed: kpiParsed,
          campaign: kpiCampaign,
          fileName: file.name,
          importedById: user.id,
          selectedWorksheetKeys,
          confirmedNewAgents,
          duplicateMode,
        });
        return NextResponse.json(result);
      }

      let preloadedWorksheetRows: Map<string, any[][]> | undefined;
      let preparsedBdoSgm: Map<string, BdoSgmParseResult> | undefined;
      let bdoSgmRankingDetected = false;
      if (selectedCampaigns.length === 1 && isBdoSgmCampaign(selectedCampaigns[0].campaignName)) {
        preloadedWorksheetRows = new Map(workbook.SheetNames.map((sheetName) => [
          sheetName,
          XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null } as any) as any[][],
        ]));
        preparsedBdoSgm = new Map(workbook.SheetNames.map((sheetName) => {
          const consolidated = parseBdoSgmConsolidatedWorksheet(
            workbook.Sheets[sheetName],
            sheetName,
            reportDate,
            reportPeriodType,
          );
          return [
            sheetName,
            consolidated.detected
              ? consolidated
              : parseBdoSgmWorksheet(preloadedWorksheetRows!.get(sheetName) || [], sheetName, reportDate),
          ];
        }));
        const visibleCardLevels = new Set(
          [...preparsedBdoSgm.values()].flatMap((result) => result.detectedCardLevels)
        );
        const rankingSheet = workbook.SheetNames.find(
          (sheetName) => preparsedBdoSgm!.get(sheetName)?.format === 'BDO SGM Ranking'
        );
        if (rankingSheet) {
          const pivotCacheResult = parseBdoSgmPivotCache(bytes, rankingSheet, reportDate);
          const containsAdditionalCardLevel = pivotCacheResult?.detectedCardLevels.some(
            (cardLevel) => !visibleCardLevels.has(cardLevel)
          );
          if (pivotCacheResult && containsAdditionalCardLevel) {
            preparsedBdoSgm.set(rankingSheet, pivotCacheResult);
          }
        }
        bdoSgmRankingDetected = [...preparsedBdoSgm.values()].some((result) => result.detected);
        const consolidatedDetected = [...preparsedBdoSgm.values()].some(
          (result) => result.format === 'BDO SGM Consolidated'
        );
        if (bdoSgmRankingDetected && !consolidatedDetected) reportPeriodType = 'monthly';
      }

      if (!bdoSgmRankingDetected && isBpiDashboardWorkbook(workbook, file.name)) {
        if (importMode === 'single') {
          return NextResponse.json({ error: 'BPI dashboard workbooks require Import All Data or Import Selected Worksheets.' }, { status: 400 });
        }
        // Route SIP/PA worksheets to BPI SIP LOANS and Personal Loans
        // worksheets to BPI PL. Both destinations are detected automatically.
        const workbookCampaigns = await ensureBpiWorkbookCampaigns(user.id);
        const bpiCampaigns = workbookCampaigns.campaigns;
        const sipCampaign = bpiCampaigns.find((campaign) => /^BPI SIP LOANS$/i.test(campaign.campaignName))!;
        const bpiPreview = buildBpiPreview(workbook, reportDate, bpiCampaigns, reportPeriodType, file.name);
        await markExistingBdoRecords(bpiPreview as unknown as ReturnType<typeof buildBdoPreview>, bpiCampaigns.map((campaign) => campaign.id), reportPeriodType);
        if (bpiPreview.workbookSummary.worksheetsAccepted === 0 || bpiPreview.workbookSummary.totalValidRecords === 0) {
          return NextResponse.json({
            error: 'The workbook contains supported BPI worksheets, but no valid mapped monthly data was found.',
            workbookSummary: bpiPreview.workbookSummary,
            worksheetPreviews: bpiPreview.worksheetPreviews,
            previewRecords: bpiPreview.previewRecords,
          }, { status: 400 });
        }
        if (mode === 'preview') {
          return NextResponse.json({
            preview: true,
            multiSheet: true,
            bpiDashboard: true,
            matched: [],
            notFound: [],
            metricType: 'all_metrics',
            reportDate: ymd(reportDate),
            reportPeriodType,
            workbookCampaign: sipCampaign,
            workbookCampaigns: bpiCampaigns,
            campaignCreated: workbookCampaigns.createdCampaignIds.length > 0,
            previewRecords: bpiPreview.previewRecords,
            monthSummary: bpiPreview.monthSummary,
            workbookSummary: bpiPreview.workbookSummary,
            worksheetPreviews: bpiPreview.worksheetPreviews,
            validationWarnings: bpiPreview.parsed.issues.slice(0, 200),
          });
        }
        const selectedWorksheetKeysValue = formData.get('selectedWorksheetKeys');
        const submittedWorksheetKeys: string[] = JSON.parse((selectedWorksheetKeysValue as string) || '[]');
        const selectedWorksheetKeys = selectedWorksheetKeysValue === null
          ? bpiPreview.worksheetPreviews.filter((sheet) => sheet.selected).map((sheet) => sheet.key)
          : submittedWorksheetKeys;
        if (selectedWorksheetKeys.length === 0) return NextResponse.json({ error: 'Select at least one valid mapped worksheet before importing.' }, { status: 400 });
        const campaignMappings = parseWorksheetCampaignMappings(formData.get('campaignMappings'));
        const selectedBpiSheets = bpiPreview.worksheetPreviews.filter((sheet) => selectedWorksheetKeys.includes(sheet.key) && sheet.validRows > 0);
        if (!selectedBpiSheets.length) return NextResponse.json({ error: 'No selected worksheets contain valid mapped rows to import.' }, { status: 400 });
        const invalidMapping = selectedBpiSheets.find((sheet) => {
          const mappedIds = campaignMappings[sheet.key] || [];
          return (sheet.campaignMapping === 'unresolved' && mappedIds.length === 0) || hasInvalidCampaignMapping(mappedIds, bpiCampaigns);
        });
        if (invalidMapping) return NextResponse.json({ error: 'Some BPI worksheets or sections are unmapped. Review the campaign mapping before importing.' }, { status: 400 });
        const hasImportableBpiRecord = selectedBpiSheets.some((sheet) => {
          const mappedIds = campaignMappings[sheet.key] || [];
          return bpiPreview.parsed.records.some((record) => {
            if (record.worksheetSource !== sheet.sheetName) return false;
            const detected = bpiPreview.recordMappings.get(record);
            if (mappedIds.length === 1) return true;
            if (mappedIds.length > 1) return detected?.source !== 'unresolved' && mappedIds.includes(detected!.campaign.id);
            return detected?.source !== 'unresolved';
          });
        });
        if (!hasImportableBpiRecord) {
          return NextResponse.json({ error: 'The selected worksheets have no records that can be matched to the chosen campaigns. If campaign values are not present in the workbook, select one campaign as the fallback.' }, { status: 400 });
        }
        const result = await persistBdoImport({
          preview: bpiPreview as unknown as ReturnType<typeof buildBdoPreview>,
          selectedCampaigns: bpiCampaigns,
          campaignMappings,
          fileName: file.name,
          importMode,
          duplicateMode,
          reportPeriodType,
          reportDate,
          importedById: user.id,
          selectedWorksheetKeys: selectedBpiSheets.map((sheet) => sheet.key),
          skipUnresolvedRecordMappings: true,
        });
        return NextResponse.json({ ...result, bpiDashboard: true, workbookCampaign: sipCampaign, workbookCampaigns: bpiCampaigns, campaignCreated: workbookCampaigns.createdCampaignIds.length > 0, unmapped: bpiPreview.workbookSummary.totalUnmappedRecords, workbookSummary: bpiPreview.workbookSummary, worksheetPreviews: bpiPreview.worksheetPreviews, normalizedImported: result.inserted, normalizedDuplicates: result.skipped });
      }

      // BPI Dashboard files create and select BPI SIP LOANS automatically.
      // Every other Excel format still requires an explicit destination.
      if (!selectedCampaigns.length) {
        return NextResponse.json({ error: 'This workbook is not a detected BPI Dashboard file. Select at least one campaign before previewing it.' }, { status: 400 });
      }

      if (!bdoSgmRankingDetected && isBdoDashboardWorkbook(workbook)) {
        if (importMode === 'single') {
          return NextResponse.json({ error: 'BDO dashboard workbooks require Import All Data or Import Selected Worksheets.' }, { status: 400 });
        }
        const bdoPreview = buildBdoPreview(workbook, reportDate, selectedCampaigns, reportPeriodType);
        await markExistingBdoRecords(bdoPreview, selectedCampaigns.map((campaign) => campaign.id), reportPeriodType);
        if (bdoPreview.workbookSummary.worksheetsAccepted === 0 || bdoPreview.workbookSummary.totalValidRecords === 0) {
          return NextResponse.json({
            error: 'The workbook contains supported BDO worksheets, but no valid monthly data was found.',
            workbookSummary: bdoPreview.workbookSummary,
            worksheetPreviews: bdoPreview.worksheetPreviews,
          }, { status: 400 });
        }
        if (mode === 'preview') {
          const agentMatches = await matchBdoAgents(bdoPreview, selectedCampaigns.map((campaign) => campaign.id));
          return NextResponse.json({
            preview: true,
            multiSheet: true,
            bdoDashboard: true,
            matched: agentMatches.matched,
            notFound: agentMatches.notFound,
            metricType: 'all_metrics',
            reportDate: ymd(reportDate),
            reportPeriodType,
            previewRecords: bdoPreview.previewRecords,
            monthSummary: bdoPreview.monthSummary,
            workbookSummary: bdoPreview.workbookSummary,
            worksheetPreviews: bdoPreview.worksheetPreviews,
            validationWarnings: bdoPreview.parsed.issues.slice(0, 200),
          });
        }
        const selectedWorksheetKeysValue = formData.get('selectedWorksheetKeys');
        const submittedWorksheetKeys: string[] = JSON.parse((selectedWorksheetKeysValue as string) || '[]');
        const selectedWorksheetKeys = selectedWorksheetKeysValue === null
          ? bdoPreview.worksheetPreviews.filter((sheet) => sheet.selected).map((sheet) => sheet.key)
          : submittedWorksheetKeys;
        if (selectedWorksheetKeys.length === 0) {
          return NextResponse.json({ error: 'Select at least one valid worksheet before importing.' }, { status: 400 });
        }
        const campaignMappings = parseWorksheetCampaignMappings(formData.get('campaignMappings'));
        const selectedBdoSheets = bdoPreview.worksheetPreviews.filter((sheet) => selectedWorksheetKeys.includes(sheet.key) && sheet.validRows > 0);
        if (selectedBdoSheets.length === 0) {
          return NextResponse.json({ error: 'No selected worksheets contain valid rows to import.' }, { status: 400 });
        }
        const invalidMapping = selectedBdoSheets.find((sheet) => {
          const mappedIds = campaignMappings[sheet.key] || [];
          return (sheet.campaignMapping === 'unresolved' && mappedIds.length === 0) || hasInvalidCampaignMapping(mappedIds, selectedCampaigns);
        });
        if (invalidMapping) {
          return NextResponse.json({ error: 'Some worksheets could not be matched to the selected campaigns. Please review the campaign mapping.' }, { status: 400 });
        }
        const result = await persistBdoImport({
          preview: bdoPreview,
          selectedCampaigns,
          campaignMappings,
          fileName: file.name,
          importMode,
          duplicateMode,
          reportPeriodType,
          reportDate,
          importedById: user.id,
          selectedWorksheetKeys: selectedBdoSheets.map((sheet) => sheet.key),
        });
        return NextResponse.json({ ...result, workbookSummary: bdoPreview.workbookSummary, worksheetPreviews: bdoPreview.worksheetPreviews, normalizedImported: result.inserted, normalizedDuplicates: result.skipped });
      }

      const preview = await buildWorkbookPreview({
        workbook,
        selectedCampaigns,
        metricType,
        selectedReportDate: reportDate,
        reportPeriodType,
        preloadedWorksheetRows,
        preparsedBdoSgm,
      });

      if (mode === 'preview') {
        if (preview.workbookSummary.totalValidRecords === 0) {
          const specificValidationError = preview.sheets.flatMap((sheet) => sheet.errors)[0];
          return NextResponse.json({
            error: specificValidationError || 'No valid production rows found in any worksheet.',
            workbookSummary: preview.workbookSummary,
            worksheetPreviews: preview.sheets.map(({ entries, ...sheet }) => sheet),
          }, { status: 400 });
        }
        return NextResponse.json({
          preview: true,
          multiSheet: true,
          matched: preview.matched,
          notFound: preview.notFound,
          metricType,
          reportDate: ymd(reportDate),
          reportPeriodType,
          reportMonth: reportDate.getMonth() + 1,
          reportYear: reportDate.getFullYear(),
          previewRecords: preview.previewRecords,
          consolidatedAgents: preview.consolidatedAgents,
          monthSummary: preview.monthSummary,
          detectedRange: preview.detectedRange,
          workbookSummary: preview.workbookSummary,
          worksheetPreviews: preview.sheets.map(({ entries, ...sheet }) => sheet),
          validationWarnings: preview.sheets.flatMap((sheet) =>
            (sheet.validationIssues || []).map((issue) => ({
              worksheet: issue.worksheet,
              row: issue.row,
              reason: issue.reason,
              warning: issue.warning,
            }))
          ),
        });
      }

      const confirmedNewAgents: string[] = JSON.parse((formData.get('confirmedNewAgents') as string) || '[]');
      const selectedWorksheetKeysValue = formData.get('selectedWorksheetKeys');
      const submittedWorksheetKeys: string[] = JSON.parse((selectedWorksheetKeysValue as string) || '[]');
      const campaignMappings = parseWorksheetCampaignMappings(formData.get('campaignMappings'));
      const selectedKeySet = new Set(
        selectedWorksheetKeysValue !== null
          ? submittedWorksheetKeys
          : preview.sheets.filter((sheet) => sheet.selected).map((sheet) => sheet.key)
      );
      const selectedSheets = preview.sheets.filter((sheet) => selectedKeySet.has(sheet.key) && sheet.validRows > 0);
      const invalidMapping = selectedSheets.find((sheet) => {
        const mappedIds = campaignMappings[sheet.key] || [];
        return (sheet.campaignMapping === 'unresolved' && mappedIds.length === 0) || hasInvalidCampaignMapping(mappedIds, selectedCampaigns);
      });
      if (invalidMapping) {
        return NextResponse.json({ error: 'Some worksheets could not be matched to the selected campaigns. Please review the campaign mapping.' }, { status: 400 });
      }
      const entries = selectedSheets.flatMap((sheet) => {
        const mappedCampaignIds = campaignMappings[sheet.key] || [];
        if (mappedCampaignIds.length === 0) return sheet.entries;
        if (mappedCampaignIds.length === 1) {
          const mappedCampaign = selectedCampaigns.find((campaign) => campaign.id === mappedCampaignIds[0])!;
          return sheet.entries.map((entry) => ({ ...entry, campaignId: mappedCampaign.id, campaignName: mappedCampaign.campaignName }));
        }
        const allowed = new Set(mappedCampaignIds);
        return sheet.entries.filter((entry) => Boolean(entry.campaignId && allowed.has(entry.campaignId)));
      }).sort((a, b) => (a.reportDate?.getTime() || 0) - (b.reportDate?.getTime() || 0) || a.rowIdx - b.rowIdx);

      if (entries.length === 0) {
        return NextResponse.json({ error: 'No selected worksheet records could be matched to the chosen campaigns. Select one campaign as the fallback when rows do not contain campaign values.' }, { status: 400 });
      }

      const importPayload = await prisma.$transaction(async (tx) => {
      const targetCampaignIds = [...new Set(entries.map((entry) => entry.campaignId || effectiveCampaignId))];
      const importAgents = await tx.user.findMany({
        where: { role: 'AGENT', campaignId: { in: targetCampaignIds } },
        select: { id: true, name: true, campaignId: true },
      });
      const findImportAgent = (name: string, targetCampaignId: string) =>
        importAgents.find((agent) => agent.campaignId === targetCampaignId && agentNameMatches(agent.name, name)) || null;
      const createdAgents: Record<string, string> = {};
      let createdAgentCount = 0;
      for (const name of confirmedNewAgents) {
        const row = entries.find((entry) => entry.name === name);
        const targetCampaignId = row?.campaignId || effectiveCampaignId;
        const existing = findImportAgent(name, targetCampaignId);
        if (existing) {
          createdAgents[name] = existing.id;
          continue;
        }

        const password = await bcrypt.hash(crypto.randomUUID(), 10);
        const newAgent = await tx.user.create({
          data: {
            name,
            email: nameToEmail(name),
            password,
            role: 'AGENT',
            campaignId: targetCampaignId,
          },
        });
        createdAgents[name] = newAgent.id;
        createdAgentCount++;
        importAgents.push({ id: newAgent.id, name: newAgent.name, campaignId: targetCampaignId });
      }

      const results = {
        success: 0,
        created: createdAgentCount,
        errors: [] as string[],
        details: [] as any[],
      };
      const entryByCampaignDate = new Map<string, string>();
      const sheetNames = selectedSheets.map((sheet) => sheet.sheetName);
      const createdEntryIds = new Set<string>();
      let enrichedRecords = 0;
      let skippedRecords = 0;
      let insertedLegacyDetails = 0;
      const normalizedRecords: any[] = [];
      const normalizedDates = entries.map((row) => normalizePeriodDate(row.reportDate || reportDate, reportPeriodType));
      const earliestDate = new Date(Math.min(...normalizedDates.map((date) => date.getTime())));
      const latestDate = new Date(Math.max(...normalizedDates.map((date) => date.getTime())));
      const importAgentIds = importAgents.map((agent) => agent.id);
      const [storedMetrics, storedDetails] = await Promise.all([
        tx.productionMetricRecord.findMany({
          where: { campaignId: { in: targetCampaignIds }, agentId: { in: importAgentIds }, reportPeriodType, reportDate: { gte: earliestDate, lte: latestDate } },
          select: {
            id: true, productionEntryId: true, campaignId: true, agentId: true, metricType: true, reportDate: true,
            cardLevel: true, count: true, volume: true, goal: true, actual: true, achievement: true,
            sourceNickname: true, finalTotal: true, firstPeriodTotal: true, secondPeriodTotal: true,
            workbookGrandTotal: true, ranking: true, monthValues: true,
          },
        }),
        tx.productionDetail.findMany({
          where: {
            campaignId: { in: targetCampaignIds }, agentId: { in: importAgentIds },
            productionEntry: { date: { gte: new Date(earliestDate.getFullYear(), earliestDate.getMonth(), 1), lte: new Date(latestDate.getFullYear(), latestDate.getMonth() + 1, 0) } },
          },
          select: {
            id: true, productionEntryId: true, campaignId: true, agentId: true, cardLevel: true,
            transmittals: true, approvals: true, booked: true, activations: true, ntb: true, supplementary: true,
            monthlyGoal: true, monthlyActual: true, monthlyAchievement: true,
            agentLevel: true,
            sourceNickname: true, cardLevelFinalTotal: true, cardLevelFirstPeriodTotal: true,
            cardLevelSecondPeriodTotal: true, cardLevelWorkbookGrandTotal: true,
            cardLevelRanking: true, cardLevelMonthValues: true,
            c2gTxn: true, c2gVol: true, btTxn: true, btVol: true, balconTxn: true, balconVol: true,
            grandTotalTxn: true, grandTotalVol: true,
            productionEntry: { select: { date: true, reportPeriodType: true, importMetricType: true } },
          },
        }),
      ]);
      const storedMetricByKey = new Map<string, any>(storedMetrics.map((record) => [normalizedMetricKey(record.campaignId, record.agentId, record.metricType, record.reportDate, reportPeriodType, record.cardLevel), record]));
      const storedDetailByKey = new Map<string, any>();
      for (const detail of storedDetails) {
        if (detail.productionEntry.reportPeriodType !== reportPeriodType) continue;
        const normalizedDate = normalizePeriodDate(detail.productionEntry.date, reportPeriodType);
        const detailKey = `${detail.campaignId}|${detail.agentId}|${ymd(normalizedDate)}|${detail.cardLevel || ''}`;
        if (!storedDetailByKey.has(detailKey)) storedDetailByKey.set(detailKey, detail);
        for (const type of legacyMetricTypes(detail)) {
          const key = normalizedMetricKey(detail.campaignId, detail.agentId, type, normalizedDate, reportPeriodType, detail.cardLevel);
          if (!storedMetricByKey.has(key)) storedMetricByKey.set(key, { productionEntryId: detail.productionEntryId, legacy: true });
        }
      }

      for (const row of entries) {
        try {
          const targetCampaignId = row.campaignId || effectiveCampaignId;
          const agent = findImportAgent(row.name, targetCampaignId);
          if (!agent) {
            results.errors.push(`${row.sourceSheet} row ${row.rowIdx}: Agent not found and not confirmed for creation ("${row.name}")`);
            continue;
          }
          const normalizedDate = normalizePeriodDate(row.reportDate || reportDate, reportPeriodType);
          const metrics = expandEntryMetrics(row);
          const existingForRow = metrics.map((metric) => storedMetricByKey.get(normalizedMetricKey(targetCampaignId, agent.id, metric.metricType, normalizedDate, reportPeriodType, row.cardLevel))).filter(Boolean);
          let rowChanged = false;
          for (const metric of metrics) {
            const key = normalizedMetricKey(targetCampaignId, agent.id, metric.metricType, normalizedDate, reportPeriodType, row.cardLevel);
            const existing = storedMetricByKey.get(key);
            if (!existing) continue;
            const enrichment: Record<string, any> = {};
            if (existing.id && duplicateMode !== 'skip') {
              if (metric.count != null) enrichment.count = BigInt(Math.round(metric.count));
              if (metric.volume != null) enrichment.volume = BigInt(Math.round(metric.volume));
              if (metric.goal != null) enrichment.goal = metric.goal;
              if (metric.actual != null) enrichment.actual = metric.actual;
              if (metric.achievement != null) enrichment.achievement = metric.achievement;
              if (row.nickname !== undefined) enrichment.sourceNickname = row.nickname;
              if (row.finalTotal !== undefined) enrichment.finalTotal = BigInt(Math.round(row.finalTotal));
              if (row.firstPeriodTotal !== undefined) enrichment.firstPeriodTotal = BigInt(Math.round(row.firstPeriodTotal));
              if (row.secondPeriodTotal !== undefined) enrichment.secondPeriodTotal = BigInt(Math.round(row.secondPeriodTotal));
              if (row.workbookGrandTotal !== undefined) enrichment.workbookGrandTotal = BigInt(Math.round(row.workbookGrandTotal));
              if (row.ranking !== undefined) enrichment.ranking = Math.round(row.ranking);
              if (row.monthValues !== undefined) enrichment.monthValues = row.monthValues;
            }
            if (Object.keys(enrichment).length) {
              await tx.productionMetricRecord.update({ where: { id: existing.id }, data: enrichment });
              Object.assign(existing, enrichment);
              enrichedRecords++;
              rowChanged = true;
            } else {
              skippedRecords++;
            }
          }

          const missingMetrics = metrics.filter((metric) => !storedMetricByKey.has(normalizedMetricKey(targetCampaignId, agent.id, metric.metricType, normalizedDate, reportPeriodType, row.cardLevel)));
          let savedEntryId = existingForRow.find((record) => record.productionEntryId)?.productionEntryId as string | undefined;
          const detailKey = `${targetCampaignId}|${agent.id}|${ymd(normalizedDate)}|${row.cardLevel || ''}`;
          const existingDetail = storedDetailByKey.get(detailKey);
          if (!savedEntryId) savedEntryId = existingDetail?.productionEntryId;
          const entryKey = `${targetCampaignId}|${ymd(normalizedDate)}`;
          if (!savedEntryId) savedEntryId = entryByCampaignDate.get(entryKey);
          if (missingMetrics.length && !savedEntryId) {
            const entryPeriodStart = reportPeriodType === 'daily' ? periodStart : normalizedDate;
            const entryPeriodEnd = reportPeriodType === 'monthly' ? new Date(normalizedDate.getFullYear(), normalizedDate.getMonth() + 1, 0)
              : reportPeriodType === 'yearly' ? new Date(normalizedDate.getFullYear(), 11, 31) : periodEnd;
            const entry = await tx.productionEntry.create({
              data: {
                campaignId: targetCampaignId, date: normalizedDate, time: new Date().toLocaleTimeString(), createdBy: user.id,
                reportPeriodType, periodStart: entryPeriodStart, periodEnd: entryPeriodEnd,
              },
            });
            savedEntryId = entry.id;
            createdEntryIds.add(entry.id);
            entryByCampaignDate.set(entryKey, entry.id);
          }
          const hasMbPaBreakdown = row.c2gTxn !== undefined;
          if (!existingDetail && savedEntryId && (missingMetrics.length > 0 || hasMbPaBreakdown)) {
            const detail = await tx.productionDetail.create({
              data: { productionEntryId: savedEntryId, agentId: agent.id, campaignId: targetCampaignId, ...buildDetailDataForWrite(row, row.metricType || metricType, false) },
              select: { id: true, productionEntryId: true },
            });
            storedDetailByKey.set(detailKey, detail);
            insertedLegacyDetails++;
            rowChanged = true;
          } else if (existingDetail && hasMbPaBreakdown) {
            // Existing detail rows are immutable in Skip/Fill Missing mode.
            // Update/Replace explicitly refreshes the imported breakdown.
            if (duplicateMode !== 'skip') {
              const breakdown = Object.fromEntries(MB_PA_DETAIL_KEYS.map((key) => [key, BigInt(row[key] || 0)]));
              await tx.productionDetail.update({ where: { id: existingDetail.id }, data: breakdown });
              Object.assign(existingDetail, breakdown);
              enrichedRecords++;
              rowChanged = true;
            }
            const metadata: Record<string, any> = {};
            if (duplicateMode !== 'skip' && row.agentLevel) metadata.agentLevel = row.agentLevel;
            if (duplicateMode !== 'skip' && row.monthlyGoal !== undefined) metadata.monthlyGoal = row.monthlyGoal;
            if (duplicateMode !== 'skip' && row.monthlyActual !== undefined) metadata.monthlyActual = row.monthlyActual;
            if (duplicateMode !== 'skip' && row.monthlyAchievement !== undefined) metadata.monthlyAchievement = row.monthlyAchievement;
            if (Object.keys(metadata).length) {
              await tx.productionDetail.update({ where: { id: existingDetail.id }, data: metadata });
              Object.assign(existingDetail, metadata);
              enrichedRecords++;
              rowChanged = true;
            }
          }
          if (existingDetail && row.nickname !== undefined) {
            const metadata: Record<string, any> = {};
            if (duplicateMode !== 'skip') metadata.sourceNickname = row.nickname;
            if (duplicateMode !== 'skip' && row.finalTotal !== undefined) metadata.cardLevelFinalTotal = BigInt(Math.round(row.finalTotal));
            if (duplicateMode !== 'skip' && row.firstPeriodTotal !== undefined) metadata.cardLevelFirstPeriodTotal = BigInt(Math.round(row.firstPeriodTotal));
            if (duplicateMode !== 'skip' && row.secondPeriodTotal !== undefined) metadata.cardLevelSecondPeriodTotal = BigInt(Math.round(row.secondPeriodTotal));
            if (duplicateMode !== 'skip' && row.workbookGrandTotal !== undefined) metadata.cardLevelWorkbookGrandTotal = BigInt(Math.round(row.workbookGrandTotal));
            if (duplicateMode !== 'skip' && row.ranking !== undefined) metadata.cardLevelRanking = Math.round(row.ranking);
            if (duplicateMode !== 'skip' && row.monthValues !== undefined) metadata.cardLevelMonthValues = row.monthValues;
            if (Object.keys(metadata).length) {
              await tx.productionDetail.update({ where: { id: existingDetail.id }, data: metadata });
              Object.assign(existingDetail, metadata);
              enrichedRecords++;
              rowChanged = true;
            }
          }
          for (const metric of missingMetrics) {
            const key = normalizedMetricKey(targetCampaignId, agent.id, metric.metricType, normalizedDate, reportPeriodType, row.cardLevel);
            normalizedRecords.push({
              productionEntryId: savedEntryId!,
              campaignId: targetCampaignId,
              agentId: agent.id,
              reportPeriodType,
              reportDate: normalizedDate,
              reportMonth: reportPeriodType === 'yearly' ? null : normalizedDate.getMonth() + 1,
              reportYear: normalizedDate.getFullYear(),
              metricType: metric.metricType,
              cardLevel: row.cardLevel || '',
              cardLevelLabel: row.cardLevelLabel || null,
              grandTotal: row.grandTotal == null ? null : BigInt(Math.round(row.grandTotal)),
              sourceNickname: row.nickname || null,
              finalTotal: row.finalTotal == null ? null : BigInt(Math.round(row.finalTotal)),
              firstPeriodTotal: row.firstPeriodTotal == null ? null : BigInt(Math.round(row.firstPeriodTotal)),
              secondPeriodTotal: row.secondPeriodTotal == null ? null : BigInt(Math.round(row.secondPeriodTotal)),
              workbookGrandTotal: row.workbookGrandTotal == null ? null : BigInt(Math.round(row.workbookGrandTotal)),
              ranking: row.ranking == null ? null : Math.round(row.ranking),
              monthValues: row.monthValues || Prisma.JsonNull,
              count: metric.count == null ? null : BigInt(Math.round(metric.count)),
              volume: metric.volume == null ? null : BigInt(Math.round(metric.volume)),
              goal: metric.goal ?? null,
              actual: metric.actual ?? null,
              achievement: metric.achievement ?? null,
              sourceFile: file.name,
              sourceSheet: row.sourceSheet || '',
              sourceRow: row.rowIdx,
            });
            storedMetricByKey.set(key, { productionEntryId: savedEntryId, pending: true });
            rowChanged = true;
          }

          if (rowChanged) {
            results.success++;
            results.details.push(detailResponse({ ...row, reportDate: normalizedDate }, agent.name, row.metricType || metricType));
          }
        } catch (rowError) {
          throw new Error(`${row.sourceSheet} row ${row.rowIdx}: Database write failed.`, { cause: rowError });
        }
      }

      const normalizedInsert = normalizedRecords.length
        ? await tx.productionMetricRecord.createMany({ data: normalizedRecords, skipDuplicates: true })
        : { count: 0 };
      skippedRecords += normalizedRecords.length - normalizedInsert.count;
      await persistImportedCampaignSettings(tx, entries);

      const auditLog = {
        fileName: file.name,
        importingUser: user.id,
        importedAt: new Date().toISOString(),
        selectedCampaigns: selectedCampaigns.map((campaign) => campaign.id),
        selectedMetric: metricType,
        selectedReportDate: ymd(reportDate),
        workbookSheetNames: workbook.SheetNames,
        perSheetResult: selectedSheets.map(({ entries: _entries, matched: _matched, notFound: _notFound, ...sheet }) => sheet),
        insertedRecords: normalizedInsert.count,
        enrichedRecords,
        insertedLegacyDetails,
        normalizedRecords: normalizedInsert.count,
        skippedRecords: skippedRecords + preview.workbookSummary.totalDuplicateRecords,
        invalidRecords: preview.workbookSummary.totalInvalidRecords,
        errorSummary: results.errors.slice(0, 50),
      };
      for (const entryId of createdEntryIds) {
        await saveImportMetadata(entryId, file.name, metricType, sheetNames, auditLog, tx);
      }

      results.details.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.agent.localeCompare(b.agent));

      return {
        message: `Import completed for ${targetCampaignIds.length} campaign${targetCampaignIds.length === 1 ? '' : 's'}: inserted ${normalizedInsert.count}, skipped ${skippedRecords + preview.workbookSummary.totalDuplicateRecords}, and found ${preview.workbookSummary.totalInvalidRecords + results.errors.length} invalid record(s).`,
        importedCampaignIds: targetCampaignIds,
        importedCampaigns: targetCampaignIds.length,
        workbookSummary: preview.workbookSummary,
        consolidatedAgents: preview.consolidatedAgents,
        worksheetPreviews: selectedSheets.map(({ entries: _entries, matched: _matched, notFound: _notFound, ...sheet }) => sheet),
        inserted: normalizedInsert.count,
        updated: enrichedRecords,
        skipped: skippedRecords + preview.workbookSummary.totalDuplicateRecords,
        invalid: preview.workbookSummary.totalInvalidRecords + results.errors.length,
        insertedLegacyDetails,
        normalizedImported: normalizedInsert.count,
        normalizedDuplicates: skippedRecords + preview.workbookSummary.totalDuplicateRecords,
        ...results,
        errors: [
          ...selectedSheets.flatMap((sheet) =>
            (sheet.validationIssues || [])
              .filter((issue) => !issue.warning)
              .map((issue) => `${issue.worksheet} row ${issue.row}: ${issue.reason}`)
          ),
          ...results.errors,
        ],
        warnings: selectedSheets.flatMap((sheet) =>
          (sheet.validationIssues || [])
            .filter((issue) => issue.warning)
            .map((issue) => `${issue.worksheet} row ${issue.row}: ${issue.reason}`)
        ),
      };
      }, { timeout: 120000 });
      return NextResponse.json(importPayload);
    }
    if (!isExcel && !isCsv) {
      return NextResponse.json({ error: 'Only .xlsx, .xls, and .csv files are supported.' }, { status: 400 });
    }

    // ─── EXCEL PATH ───────────────────────────────────────────────────────────
    if (isExcel) {
      const fileBuffer = await file.arrayBuffer();
      const workbook = XLSX.read(new Uint8Array(fileBuffer), { type: 'array' });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];

      if (!sheet) {
        return NextResponse.json({ error: 'No sheet found in Excel file' }, { status: 400 });
      }

      const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 } as any);

      if (rows.length < 3) {
        return NextResponse.json({ error: 'Excel file has insufficient rows' }, { status: 400 });
      }

      const entries = parseExcelRows(rows, metricType, campaignName);
      if (entries.length === 0) {
        return NextResponse.json(
          {
            error:
              'No production rows found. Check that required columns exist: FULL NAME or LAST NAME/FIRST NAME plus COUNT, TRANSMITTED, APPROVALS, BOOKED, VOLUME, NTB, or SUPPLEMENTARY.',
          },
          { status: 400 }
        );
      }

      // ── PREVIEW MODE: classify agents, no DB writes ──────────────────────
      if (mode === 'preview') {
        const matched: any[] = [];
        const notFound: any[] = [];

        for (const entry of entries) {
          const agent = findExistingAgent(entry.name);

          const baseData: any = { name: entry.name, count: entry.count, volume: entry.volume };
          if (metricType === 'all_metrics') {
            baseData.transmittals = entry.transmittals;
            baseData.approvals = entry.approvals;
            baseData.booked = entry.booked;
          }
          if (entry.ntb !== undefined || entry.seatCategory !== undefined) {
            baseData.ntb = entry.ntb ?? 0;
            baseData.supplementary = entry.supplementary ?? 0;
            baseData.seatCategory = entry.seatCategory ?? '';
          }

          if (agent) {
            matched.push({ ...baseData, agentId: agent.id, agentName: agent.name });
          } else {
            notFound.push(baseData);
          }
        }

        // Sort by volume descending, then by count/metrics descending
        matched.sort((a, b) => {
          if (b.volume !== a.volume) return b.volume - a.volume;
          return b.count - a.count;
        });
        notFound.sort((a, b) => {
          if (b.volume !== a.volume) return b.volume - a.volume;
          return b.count - a.count;
        });

        return NextResponse.json({ preview: true, matched, notFound, metricType, reportDate });
      }

      // ── IMPORT MODE ──────────────────────────────────────────────────────
      const confirmedNewAgents: string[] = JSON.parse(
        (formData.get('confirmedNewAgents') as string) || '[]'
      );

      // Create any confirmed new agents
      const createdAgents: Record<string, string> = {}; // name → id
      for (const name of confirmedNewAgents) {
        const existing = findExistingAgent(name);
        if (existing) {
          createdAgents[name] = existing.id;
          continue;
        }

        const email = nameToEmail(name);
        const password = await bcrypt.hash(crypto.randomUUID(), 10);
        const newAgent = await prisma.user.create({
          data: {
            name,
            email,
            password,
            role: 'AGENT',
            campaignId: effectiveCampaignId,
          },
        });
        createdAgents[name] = newAgent.id;
        rememberAgent({ id: newAgent.id, name: newAgent.name });
      }

      const results = {
        success: 0,
        created: confirmedNewAgents.length,
        errors: [] as string[],
        details: [] as any[],
      };

      // Create one ProductionEntry for the batch
      const entry = await prisma.productionEntry.create({
        data: {
          campaignId: effectiveCampaignId,
          date: reportDate,
          time: new Date().toLocaleTimeString(),
          createdBy: user.id,
          reportPeriodType,
          periodStart,
          periodEnd,
        },
      });
      await saveImportMetadata(entry.id, file.name, metricType);

      for (const row of entries) {
        try {
          let agent = findExistingAgent(row.name);

          // Use newly created agent if available
          if (!agent && createdAgents[row.name]) {
            agent = await prisma.user.findUnique({
              where: { id: createdAgents[row.name] },
              select: { id: true, name: true },
            });
          }

          if (!agent) {
            results.errors.push(`Row ${row.rowIdx}: Agent not found and not confirmed for creation ("${row.name}")`);
            continue;
          }

          const metricData = buildDetailData(row, metricType);

          const existingDetail = await prisma.productionDetail.findUnique({
            where: {
              productionEntryId_agentId_cardLevel: {
                productionEntryId: entry.id,
                agentId: agent.id,
                cardLevel: row.cardLevel || '',
              },
            },
          });

          if (existingDetail) {
            await prisma.productionDetail.update({
              where: { id: existingDetail.id },
              data: metricData,
            });
          } else {
            await prisma.productionDetail.create({
              data: {
                productionEntryId: entry.id,
                agentId: agent.id,
                campaignId: effectiveCampaignId,
                ...metricData,
              },
            });
          }

          results.success++;
          const detail: any = {
            row: row.rowIdx,
            agent: agent.name,
            date: reportDate.toLocaleDateString(),
            volume: row.volume,
          };
          if (metricType === 'all_metrics') {
            detail.transmittals = row.transmittals;
            detail.approvals = row.approvals;
            detail.booked = row.booked;
          } else {
            detail[metricType] = row.count;
          }
          if (row.ntb !== undefined) {
            detail.ntb = row.ntb;
            detail.supplementary = row.supplementary;
            detail.seatCategory = row.seatCategory;
          }
          results.details.push(detail);
        } catch (rowError: any) {
          results.errors.push(`Row ${row.rowIdx}: ${rowError.message}`);
        }
      }

      // Sort results by volume descending, then by the primary metric
      results.details.sort((a, b) => {
        if (b.volume !== a.volume) return b.volume - a.volume;
        const aMetric = metricType === 'all_metrics' ? a.transmittals : a[metricType] || a.count || 0;
        const bMetric = metricType === 'all_metrics' ? b.transmittals : b[metricType] || b.count || 0;
        return bMetric - aMetric;
      });

      return NextResponse.json({
        message: `Imported ${results.success} records. ${results.created} new agent(s) created.`,
        ...results,
      });
    }

    // ─── CSV PATH — same BPI PA column format as Excel ───────────────────────
    if (!selectedCampaigns.length) {
      return NextResponse.json({ error: 'Select at least one campaign before previewing a CSV file.' }, { status: 400 });
    }
    const text = await file.text();
    const lines = text.trim().split('\n').filter(l => l.trim());

    if (lines.length < 2) {
      return NextResponse.json({ error: 'CSV must have a header row and at least one data row' }, { status: 400 });
    }

    // Convert CSV text to 2D array and reuse the same Excel parser
    const csvRows = lines.map(line =>
      line.split(',').map(cell => {
        const v = cell.trim().replace(/^"|"$/g, '');
        const n = Number(v);
        return v === '' ? null : isNaN(n) ? v : n;
      })
    );

    const csvSheetName = file.name.replace(/[\r\n\t]/g, ' ').slice(0, 80) || 'CSV';
    const csvWorkbook = {
      SheetNames: [csvSheetName],
      Sheets: { [csvSheetName]: XLSX.utils.aoa_to_sheet(csvRows) },
    } as XLSX.WorkBook;
    const csvPreview = await buildWorkbookPreview({
      workbook: csvWorkbook,
      selectedCampaigns,
      metricType,
      selectedReportDate: reportDate,
      reportPeriodType,
    });
    const csvEntries = csvPreview.sheets.flatMap((sheet) => sheet.entries)
      .sort((a, b) => (a.reportDate?.getTime() || 0) - (b.reportDate?.getTime() || 0) || a.rowIdx - b.rowIdx);

    if (csvEntries.length === 0) {
      return NextResponse.json({ error: 'No data rows found. Check that your CSV matches the BPI PA template format.' }, { status: 400 });
    }

    // Preview mode for CSV
    if (mode === 'preview') {
      return NextResponse.json({
        preview: true,
        matched: csvPreview.matched,
        notFound: csvPreview.notFound,
        previewRecords: csvPreview.previewRecords,
        monthSummary: csvPreview.monthSummary,
        detectedRange: csvPreview.detectedRange,
        workbookSummary: csvPreview.workbookSummary,
        worksheetPreviews: csvPreview.sheets.map(({ entries, ...sheet }) => sheet),
        metricType,
        reportPeriodType,
        reportDate: ymd(reportDate),
      });
    }

    // Import mode for CSV
    const csvCampaignMappings = parseWorksheetCampaignMappings(formData.get('campaignMappings'));
    const csvSheetPreview = csvPreview.sheets[0];
    const csvMappedCampaignIds = csvCampaignMappings[csvSheetPreview.key] || [];
    if (csvMappedCampaignIds.length > 1) {
      return NextResponse.json({ error: 'This CSV does not contain per-record campaign mappings. Select one campaign for this worksheet before importing.' }, { status: 400 });
    }
    const csvTargetCampaignId = csvMappedCampaignIds[0] || (csvSheetPreview.campaignMapping === 'unresolved' ? '' : csvSheetPreview.campaignId);
    if (!csvTargetCampaignId || !selectedCampaigns.some((campaign) => campaign.id === csvTargetCampaignId)) {
      return NextResponse.json({ error: 'The CSV could not be matched automatically. Please review the campaign mapping.' }, { status: 400 });
    }
    const csvCampaignAgents = await prisma.user.findMany({ where: { campaignId: csvTargetCampaignId, role: 'AGENT' }, select: { id: true, name: true } });
    const findCsvAgent = (name: string) => csvCampaignAgents.find((agent) => agentNameMatches(agent.name, name)) || null;
    const csvImportPayload = await prisma.$transaction(async (tx) => {
    const confirmedNewAgentsCsv: string[] = JSON.parse(
      (formData.get('confirmedNewAgents') as string) || '[]'
    );

    const createdAgentsCsv: Record<string, string> = {};
    for (const name of confirmedNewAgentsCsv) {
      const existing = findCsvAgent(name);
      if (existing) { createdAgentsCsv[name] = existing.id; continue; }

      const email = nameToEmail(name);
      const password = await bcrypt.hash(crypto.randomUUID(), 10);
      const newAgent = await tx.user.create({
        data: { name, email, password, role: 'AGENT', campaignId: csvTargetCampaignId },
      });
      createdAgentsCsv[name] = newAgent.id;
      csvCampaignAgents.push({ id: newAgent.id, name: newAgent.name });
    }

    const csvResults = {
      success: 0,
      created: confirmedNewAgentsCsv.length,
      errors: [] as string[],
      details: [] as any[],
    };

    const normalizedCsvRecords: any[] = [];
    const csvEntryByDate = new Map<string, string>();
    const csvCreatedEntryIds = new Set<string>();
    let csvEnriched = 0;
    let csvSkipped = 0;
    const csvDates = csvEntries.map((row) => normalizePeriodDate(row.reportDate || reportDate, reportPeriodType));
    const csvEarliest = new Date(Math.min(...csvDates.map((date) => date.getTime())));
    const csvLatest = new Date(Math.max(...csvDates.map((date) => date.getTime())));
    const csvAgentIds = csvCampaignAgents.map((agent) => agent.id);
    const [csvStoredMetrics, csvStoredDetails] = await Promise.all([
      tx.productionMetricRecord.findMany({
        where: { campaignId: csvTargetCampaignId, agentId: { in: csvAgentIds }, reportPeriodType, reportDate: { gte: csvEarliest, lte: csvLatest } },
        select: { id: true, productionEntryId: true, campaignId: true, agentId: true, metricType: true, reportDate: true, count: true, volume: true, goal: true, actual: true, achievement: true },
      }),
      tx.productionDetail.findMany({
        where: { campaignId: csvTargetCampaignId, agentId: { in: csvAgentIds }, productionEntry: { date: { gte: new Date(csvEarliest.getFullYear(), csvEarliest.getMonth(), 1), lte: new Date(csvLatest.getFullYear(), csvLatest.getMonth() + 1, 0) } } },
        select: {
          id: true, productionEntryId: true, campaignId: true, agentId: true,
          transmittals: true, approvals: true, booked: true, activations: true, ntb: true, supplementary: true,
          monthlyGoal: true, monthlyActual: true, monthlyAchievement: true,
          productionEntry: { select: { date: true, reportPeriodType: true, importMetricType: true } },
        },
      }),
    ]);
    const csvMetricByKey = new Map<string, any>(csvStoredMetrics.map((record) => [normalizedMetricKey(record.campaignId, record.agentId, record.metricType, record.reportDate, reportPeriodType), record]));
    const csvDetailByKey = new Map<string, any>();
    for (const detail of csvStoredDetails) {
      if (detail.productionEntry.reportPeriodType !== reportPeriodType) continue;
      const date = normalizePeriodDate(detail.productionEntry.date, reportPeriodType);
      const detailKey = `${detail.campaignId}|${detail.agentId}|${ymd(date)}`;
      if (!csvDetailByKey.has(detailKey)) csvDetailByKey.set(detailKey, detail);
      for (const type of legacyMetricTypes(detail)) {
        const key = normalizedMetricKey(detail.campaignId, detail.agentId, type, date, reportPeriodType);
        if (!csvMetricByKey.has(key)) csvMetricByKey.set(key, { productionEntryId: detail.productionEntryId, legacy: true });
      }
    }

    for (const row of csvEntries) {
      try {
        let agent = findCsvAgent(row.name);
        if (!agent && createdAgentsCsv[row.name]) {
          agent = await tx.user.findUnique({ where: { id: createdAgentsCsv[row.name] }, select: { id: true, name: true } });
        }
        if (!agent) {
          csvResults.errors.push(`Row ${row.rowIdx}: Agent not found and not confirmed for creation ("${row.name}")`);
          continue;
        }

        const normalizedDate = normalizePeriodDate(row.reportDate || reportDate, reportPeriodType);
        const metrics = expandEntryMetrics(row);
        const existingForRow = metrics.map((metric) => csvMetricByKey.get(normalizedMetricKey(csvTargetCampaignId, agent!.id, metric.metricType, normalizedDate, reportPeriodType))).filter(Boolean);
        let rowChanged = false;
        for (const metric of metrics) {
          const key = normalizedMetricKey(csvTargetCampaignId, agent.id, metric.metricType, normalizedDate, reportPeriodType);
          const existing = csvMetricByKey.get(key);
          if (!existing) continue;
          const enrichment: Record<string, any> = {};
          if (existing.id && duplicateMode !== 'skip') {
            if (metric.count != null) enrichment.count = BigInt(Math.round(metric.count));
            if (metric.volume != null) enrichment.volume = BigInt(Math.round(metric.volume));
            if (metric.goal != null) enrichment.goal = metric.goal;
            if (metric.actual != null) enrichment.actual = metric.actual;
            if (metric.achievement != null) enrichment.achievement = metric.achievement;
          }
          if (Object.keys(enrichment).length) {
            await tx.productionMetricRecord.update({ where: { id: existing.id }, data: enrichment });
            Object.assign(existing, enrichment);
            csvEnriched++;
            rowChanged = true;
          } else csvSkipped++;
        }
        const missingMetrics = metrics.filter((metric) => !csvMetricByKey.has(normalizedMetricKey(csvTargetCampaignId, agent!.id, metric.metricType, normalizedDate, reportPeriodType)));
        const detailKey = `${csvTargetCampaignId}|${agent.id}|${ymd(normalizedDate)}`;
        const existingDetail = csvDetailByKey.get(detailKey);
        let savedEntryId = existingForRow.find((record) => record.productionEntryId)?.productionEntryId || existingDetail?.productionEntryId || csvEntryByDate.get(ymd(normalizedDate));
        if (missingMetrics.length && !savedEntryId) {
          const entry = await tx.productionEntry.create({
            data: {
              campaignId: csvTargetCampaignId, date: normalizedDate, time: new Date().toLocaleTimeString(), createdBy: user.id, reportPeriodType,
              periodStart: reportPeriodType === 'daily' ? periodStart : normalizedDate,
              periodEnd: reportPeriodType === 'monthly' ? new Date(normalizedDate.getFullYear(), normalizedDate.getMonth() + 1, 0) : reportPeriodType === 'yearly' ? new Date(normalizedDate.getFullYear(), 11, 31) : periodEnd,
            },
          });
          savedEntryId = entry.id;
          csvEntryByDate.set(ymd(normalizedDate), entry.id);
          csvCreatedEntryIds.add(entry.id);
        }
        if (missingMetrics.length && !existingDetail && existingForRow.length === 0 && savedEntryId) {
          const detail = await tx.productionDetail.create({
            data: { productionEntryId: savedEntryId, agentId: agent.id, campaignId: csvTargetCampaignId, ...buildDetailDataForWrite(row, row.metricType || metricType, false) },
            select: { id: true, productionEntryId: true },
          });
          csvDetailByKey.set(detailKey, detail);
        }
        for (const metric of missingMetrics) {
          const key = normalizedMetricKey(csvTargetCampaignId, agent.id, metric.metricType, normalizedDate, reportPeriodType);
          normalizedCsvRecords.push({
            productionEntryId: savedEntryId!, campaignId: csvTargetCampaignId, agentId: agent.id,
            reportPeriodType, reportDate: normalizedDate,
            reportMonth: reportPeriodType === 'yearly' ? null : normalizedDate.getMonth() + 1,
            reportYear: normalizedDate.getFullYear(), metricType: metric.metricType,
            count: metric.count == null ? null : BigInt(Math.round(metric.count)),
            volume: metric.volume == null ? null : BigInt(Math.round(metric.volume)),
            goal: metric.goal ?? null, actual: metric.actual ?? null, achievement: metric.achievement ?? null,
            sourceFile: file.name, sourceSheet: row.sourceSheet || 'CSV', sourceRow: row.rowIdx,
          });
          csvMetricByKey.set(key, { productionEntryId: savedEntryId, pending: true });
          rowChanged = true;
        }
        if (rowChanged) {
          csvResults.success++;
          csvResults.details.push(detailResponse({ ...row, reportDate: normalizedDate }, agent.name, row.metricType || metricType));
        }
      } catch (rowError) {
        throw new Error(`Row ${row.rowIdx}: Database write failed.`, { cause: rowError });
      }
    }
    const normalizedCsvInsert = normalizedCsvRecords.length
      ? await tx.productionMetricRecord.createMany({ data: normalizedCsvRecords, skipDuplicates: true })
      : { count: 0 };
    csvSkipped += normalizedCsvRecords.length - normalizedCsvInsert.count;
    await persistImportedCampaignSettings(tx, csvEntries.map((entry) => ({ ...entry, campaignId: csvTargetCampaignId })));
    for (const entryId of csvCreatedEntryIds) await saveImportMetadata(entryId, file.name, metricType, [csvSheetName], undefined, tx);

    csvResults.details.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.agent.localeCompare(b.agent));

    return {
      message: `Import completed for 1 campaign: inserted ${normalizedCsvInsert.count}, skipped ${csvSkipped + csvPreview.workbookSummary.totalDuplicateRecords}, and found ${csvPreview.workbookSummary.totalInvalidRecords + csvResults.errors.length} invalid record(s).`,
      importedCampaignIds: [csvTargetCampaignId],
      importedCampaigns: 1,
      inserted: normalizedCsvInsert.count,
      updated: csvEnriched,
      skipped: csvSkipped + csvPreview.workbookSummary.totalDuplicateRecords,
      invalid: csvPreview.workbookSummary.totalInvalidRecords + csvResults.errors.length,
      normalizedImported: normalizedCsvInsert.count,
      normalizedDuplicates: csvSkipped + csvPreview.workbookSummary.totalDuplicateRecords,
      ...csvResults,
    };
    }, { timeout: 120000 });
    return NextResponse.json(csvImportPayload);
  } catch (error) {
    console.error('Bulk import error:', error);
    return NextResponse.json({ error: 'Import failed. No records were saved.' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    if (user?.role !== 'COLLECTOR') {
      return NextResponse.json({ error: 'Only collectors can delete bulk imports' }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const entryId = searchParams.get('entryId');
    if (!entryId) {
      return NextResponse.json({ error: 'Import id is required' }, { status: 400 });
    }

    const entry = await prisma.productionEntry.findFirst({
      where: { id: entryId, createdBy: user.id },
      select: { id: true },
    });
    if (!entry) {
      const deleted = await prisma.$executeRaw`DELETE FROM "DashboardImportBatch" WHERE id = ${entryId} AND "importedById" = ${user.id}`;
      if (!deleted) return NextResponse.json({ error: 'Import file not found' }, { status: 404 });
      return NextResponse.json({ deleted: true });
    }

    await prisma.$transaction([
      prisma.productionDetail.deleteMany({ where: { productionEntryId: entryId } }),
      prisma.productionEntry.deleteMany({ where: { id: entryId, createdBy: user.id } }),
    ]);

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Bulk import delete error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
