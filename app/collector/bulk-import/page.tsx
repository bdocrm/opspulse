'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageTitle } from '@/components/layout/page-title';
import { SortableDateHeader, compareDateValues, type DateSortDirection } from '@/components/sortable-date-header';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { CampaignMultiSelect } from '@/components/campaign-multi-select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Upload, AlertCircle, CheckCircle, Download, UserPlus, Users, ArrowLeft, Eye, FileText, Trash2, X } from 'lucide-react';
import { formatAchievement, formatProductionMetric } from '@/lib/production-metrics';

type Step = 'configure' | 'previewing' | 'confirm' | 'importing' | 'done';
type ImportMode = 'all' | 'worksheets' | 'single';
type ReportPeriodType = 'daily' | 'monthly' | 'yearly';
type DuplicateMode = 'skip' | 'update' | 'replace_period';

interface NormalizedPreviewRecord {
  fileName?: string;
  sheet: string;
  campaignName: string;
  agent: string;
  cardLevel?: string;
  cardLevelLabel?: string;
  grandTotal?: number | null;
  reportPeriodType: ReportPeriodType;
  reportDate: string;
  metricType: string;
  count?: number | null;
  volume?: number | null;
  goal?: number | null;
  actual?: number | null;
  achievement?: number | null;
  c2gTxn?: number;
  btTxn?: number;
  balconTxn?: number;
  grandTotalTxn?: number;
  c2gVol?: number;
  btVol?: number;
  balconVol?: number;
  grandTotalVol?: number;
  status: string;
  validationMessage?: string;
  row: number;
}

interface MatchedAgent {
  name: string;
  count: number;
  volume: number;
  cardLevel?: string;
  cardLevelLabel?: string;
  grandTotal?: number | null;
  agentId: string;
  agentName: string;
  transmittals?: number;
  approvals?: number;
  booked?: number;
  ntb?: number;
  supplementary?: number;
  seatCategory?: string;
  sheet?: string;
  campaignName?: string;
  metricType?: string;
  reportDate?: string;
  fileName?: string;
  row?: number;
  goal?: number;
  actual?: number;
  achievement?: number;
  c2gTxn?: number;
  btTxn?: number;
  balconTxn?: number;
  grandTotalTxn?: number;
  c2gVol?: number;
  btVol?: number;
  balconVol?: number;
  grandTotalVol?: number;
}

interface NewAgent {
  name: string;
  count: number;
  volume: number;
  cardLevel?: string;
  cardLevelLabel?: string;
  grandTotal?: number | null;
  approved: boolean;
  transmittals?: number;
  approvals?: number;
  booked?: number;
  ntb?: number;
  supplementary?: number;
  seatCategory?: string;
  sheet?: string;
  campaignName?: string;
  metricType?: string;
  reportDate?: string;
  fileName?: string;
  row?: number;
  goal?: number;
  actual?: number;
  achievement?: number;
  c2gTxn?: number;
  btTxn?: number;
  balconTxn?: number;
  grandTotalTxn?: number;
  c2gVol?: number;
  btVol?: number;
  balconVol?: number;
  grandTotalVol?: number;
}

interface ImportFileSummary {
  id: string;
  campaignName: string;
  campaignId?: string;
  fileName: string;
  metricType: string;
  reportDate: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  importedAt: string;
  detailCount: number;
  totals: {
    transmittals: number;
    approvals: number;
    booked: number;
    volume: number;
    ntb: number;
    supplementary: number;
  };
  details?: Array<{
    id: string;
    agent: string;
    seatNumber: number | null;
    transmittals: number;
    approvals: number;
    booked: number;
    volume: number;
    ntb: number;
    supplementary: number;
    seatCategory?: string | null;
    cardLevel?: string;
    cardLevelLabel?: string | null;
    grandTotal?: number | null;
  }>;
}

interface WorksheetPreview {
  key: string;
  sheetName: string;
  hidden: boolean;
  selected: boolean;
  format: string;
  campaignName: string;
  campaignId?: string;
  campaignMapping: 'sheet' | 'record' | 'selected' | 'unresolved';
  metricType: string;
  metricSource: 'sheet' | 'selected';
  reportDate: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  unmappedRows?: number;
  detectedMonths?: string[];
  detectedCampaigns?: string[];
  detectedMetrics?: string[];
  detectedCardLevels?: string[];
  warnings: string[];
  errors: string[];
  fileName?: string;
}

interface WorkbookSummary {
  totalWorksheets: number;
  worksheetsAccepted: number;
  worksheetsSkipped: number;
  totalValidRecords: number;
  totalInvalidRecords: number;
  totalDuplicateRecords: number;
  totalUnmappedRecords?: number;
  workbookYear?: number;
  supportedWorksheets?: string[];
  unsupportedWorksheets?: string[];
  detectedMonths?: string[];
  detectedCategories?: string[];
  detectedMetrics?: string[];
  detectedCardLevels?: string[];
  agentCount?: number;
  teamLeaderCount?: number;
  manpowerRecordCount?: number;
  detectedWorksheet?: string;
  finalFcTotal?: number;
  finalBcTotal?: number;
  wholeYearTotalFc?: number;
  wholeYearTotalBc?: number;
  campaignDistribution?: Array<{
    campaignId: string;
    campaignName: string;
    worksheets: string[];
    agents: number;
    metrics: number;
    records: number;
    months: string[];
  }>;
}

interface ProductionCampaignMapping {
  source: string;
  normalizedSource: string;
  matchedCampaignId: string | null;
  matchedCampaignName: string | null;
  suggestion: { id: string; name: string; confidence: number } | null;
  resolution: 'EXACT' | 'ALIAS' | 'SUGGESTED' | 'CREATE';
  requiresReview: boolean;
}

interface ProductionBusinessUnitMapping {
  key: string;
  campaignNormalized: string;
  source: string;
  normalizedSource: string;
  matchedBusinessUnitId: string | null;
  matchedBusinessUnitName: string | null;
  suggestion: { id: string; name: string; confidence: number } | null;
  requiresReview: boolean;
}

interface ProductionBulkPreviewRecord {
  rowKey: string;
  campaignSource: string;
  campaignNormalized: string;
  businessUnitSource: string;
  businessUnitNormalized: string;
  reportYear: number | null;
  reportMonth: number | null;
  metricType: string;
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
  sourceSheet: string;
  sourceRow: number;
  status: 'NEW' | 'UPDATED' | 'UNCHANGED' | 'CONFLICT' | 'WARNING' | 'ERROR';
  issues: Array<{ level: 'WARNING' | 'ERROR'; code: string; message: string }>;
}

interface ProductionBulkPreview {
  fileName: string;
  reportingPeriods: Array<{ year: number; month: number }>;
  detectedWeeks: number[];
  excludedFields: string[];
  campaignMappings: ProductionCampaignMapping[];
  businessUnitMappings: ProductionBusinessUnitMapping[];
  availableCampaigns: Array<{ id: string; name: string }>;
  availableBusinessUnits: Array<{ id: string; campaignId: string; name: string }>;
  canCreateCampaigns: boolean;
  records: ProductionBulkPreviewRecord[];
  stats: { total: number; valid: number; new: number; updated: number; unchanged: number; conflicts: number; warnings: number; errors: number };
}

interface ConsolidatedAgentPreview {
  fileName?: string;
  nickname: string;
  fullName: string;
  reportYear: number;
  sourceSheet: string;
  sourceRow: number;
  fcMonths: Array<{ month: number; label: string; value: number; available: boolean; originalValue: string | number | null }>;
  bcMonths: Array<{ month: number; label: string; value: number; available: boolean; originalValue: string | number | null }>;
  finalFcTotal: number;
  finalBcTotal: number;
  wholeYearTotalFc: number;
  wholeYearTotalBc: number;
  ranking: number | null;
  validationStatus: 'Valid' | 'Warning';
  warnings: string[];
}

interface MonthImportSummary {
  month: string;
  label: string;
  reportDate: string;
  new: number;
  existing: number;
  invalid: number;
}

type WorksheetCampaignMappings = Record<string, string[]>;

function worksheetValidationReason(sheet: WorksheetPreview, mappings: WorksheetCampaignMappings) {
  if (sheet.validRows <= 0) return sheet.totalRows <= 0 ? 'Worksheet is empty.' : 'No valid importable records were detected.';
  if (/^(unsupported|skipped|invalid)$/i.test(sheet.format)) return `Unsupported or invalid worksheet format: ${sheet.format}.`;
  if (sheet.errors.length > 0) return sheet.errors[0] || 'Worksheet validation failed.';
  if (sheet.campaignMapping !== 'record' && !mappings[sheet.key]?.length) return 'Campaign mapping could not be detected confidently. Select one or more campaigns to continue.';
  return '';
}

function isWorksheetEligible(sheet: WorksheetPreview, mappings: WorksheetCampaignMappings) {
  return worksheetValidationReason(sheet, mappings) === '';
}

const METRIC_LABELS: Record<string, string> = {
  transmittals: 'Transmitted',
  approvals: 'Approvals',
  booked: 'Booked',
  activations: 'Activations',
  all: 'ALL METRICS',
  all_metrics: 'All (Transmitted, Approvals, Booked)',
  acq: 'ACQ (NTB & Supplementary)',
  kpi: 'KPI (QA, AHT, Adherence, CM, CD)',
};

const formatDateTime = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : '-';

const formatDate = (value?: string | null) =>
  value
    ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : '-';

const metricLabel = (value: string) => METRIC_LABELS[value] || value.replace(/_/g, ' ');

const cardLevelLabel = (value?: string | null, originalLabel?: string | null) => {
  if (value === 'FIRST_CARD') return '1st Card';
  if (value === 'BUNDLE_CARD') return 'Bundle Card';
  return originalLabel || value?.replace(/_/g, ' ') || '-';
};

const cardLevelRank = (value?: string | null) =>
  value === 'FIRST_CARD' ? 0 : value === 'BUNDLE_CARD' ? 1 : 2;

const mbPaBreakdown = (row: NormalizedPreviewRecord, type: 'trans' | 'billings') => {
  const values = type === 'trans'
    ? [row.c2gTxn, row.btTxn, row.balconTxn, row.grandTotalTxn]
    : [row.c2gVol, row.btVol, row.balconVol, row.grandTotalVol];
  return values.every((value) => value == null)
    ? '-'
    : values.map((value) => Number(value || 0).toLocaleString()).join(' / ');
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const toYmd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// BPI PA raw files carry the reporting period only in the filename
// (e.g. "BPI PA - MAY 2026 MTD TRANSMITTAL RAW.xlsx"), not inside the sheet.
// Detect the month/year and derive the MTD range: 1st of the month through the
// last day (or today, if the file is for the current month).
function detectMTDPeriod(filename: string): { label: string; startYmd: string; endYmd: string } | null {
  const lower = filename.toLowerCase();
  let monthIdx = -1;
  for (let i = 0; i < 12; i++) {
    if (new RegExp(`\\b(${MONTHS[i]}|${MONTH_ABBR[i]})\\b`).test(lower)) { monthIdx = i; break; }
  }
  if (monthIdx < 0) return null;

  const yearMatch = lower.match(/\b(20\d{2})\b/);
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();

  const start = new Date(year, monthIdx, 1);
  const lastDay = new Date(year, monthIdx + 1, 0);
  const now = new Date();
  const end = year === now.getFullYear() && monthIdx === now.getMonth() ? now : lastDay;

  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return { label: `${fmt(start)} – ${fmt(end)}, ${year}`, startYmd: toYmd(start), endYmd: toYmd(end) };
}

export default function BulkImportPage() {
  const { data: session, status, update: updateSession } = useSession();
  const router = useRouter();

  // Settings
  const [files, setFiles] = useState<File[]>([]);
  const [importMode, setImportMode] = useState<ImportMode>('all');
  const [selectedFileNames, setSelectedFileNames] = useState<string[]>([]);
  const [metricType, setMetricType] = useState('all');
  const [lastSingleMetric, setLastSingleMetric] = useState('transmittals');
  const [campaigns, setCampaigns] = useState<{ id: string; campaignName: string }[]>([]);
  const [campaignIds, setCampaignIds] = useState<string[]>([]);
  const [reportDate, setReportDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [reportPeriodType, setReportPeriodType] = useState<ReportPeriodType>('daily');
  const [duplicateMode, setDuplicateMode] = useState<DuplicateMode>('skip');
  const [reportMonth, setReportMonth] = useState(() => new Date().getMonth() + 1);
  const [reportYear, setReportYear] = useState(() => new Date().getFullYear());
  const [detectedPeriod, setDetectedPeriod] = useState<{ label: string; startYmd: string; endYmd: string } | null>(null);

  // Flow state
  const [step, setStep] = useState<Step>('configure');
  const [matched, setMatched] = useState<MatchedAgent[]>([]);
  const [newAgents, setNewAgents] = useState<NewAgent[]>([]);
  const [worksheetPreviews, setWorksheetPreviews] = useState<WorksheetPreview[]>([]);
  const [workbookSummary, setWorkbookSummary] = useState<WorkbookSummary | null>(null);
  const [selectedWorksheetKeys, setSelectedWorksheetKeys] = useState<string[]>([]);
  const [worksheetCampaigns, setWorksheetCampaigns] = useState<WorksheetCampaignMappings>({});
  const [importResult, setImportResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [importDateSort, setImportDateSort] = useState<DateSortDirection>('desc');
  const [importHistoryDateSort, setImportHistoryDateSort] = useState<DateSortDirection>('desc');
  const [selectedImport, setSelectedImport] = useState<ImportFileSummary | null>(null);
  const [loadingImportDetails, setLoadingImportDetails] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ImportFileSummary | null>(null);
  const [deletingImport, setDeletingImport] = useState(false);
  const [previewFiles, setPreviewFiles] = useState<Array<{ file: File; index: number }>>([]);
  const [previewFilter, setPreviewFilter] = useState({ file: '', sheet: '', campaign: '', month: '', cardLevel: '', metric: '', status: '' });
  const [normalizedPreviewRecords, setNormalizedPreviewRecords] = useState<NormalizedPreviewRecord[]>([]);
  const [consolidatedAgentPreviews, setConsolidatedAgentPreviews] = useState<ConsolidatedAgentPreview[]>([]);
  const [monthSummaries, setMonthSummaries] = useState<MonthImportSummary[]>([]);
  const [productionPreview, setProductionPreview] = useState<ProductionBulkPreview | null>(null);
  const [productionCampaignSelections, setProductionCampaignSelections] = useState<Record<string, string>>({});
  const [productionBusinessSelections, setProductionBusinessSelections] = useState<Record<string, string>>({});
  const previewInFlight = useRef(false);
  const campaignAccessRefreshed = useRef(false);

  const fetcher = (url: string) => fetch(url).then((res) => res.json());
  const { data: importHistoryData, mutate: mutateImportHistory } = useSWR<{
    imports: ImportFileSummary[];
    campaigns: Array<{ id: string; campaignName: string }>;
  }>(
    (session?.user as any)?.role === 'COLLECTOR' ? '/api/collectors/bulk-import' : null,
    fetcher
  );

  // Load campaigns for the picker and default to the collector's assigned one
  useEffect(() => {
    fetch('/api/campaigns')
      .then(res => (res.ok ? res.json() : []))
      .then(data => setCampaigns(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Campaign assignments can change while a collector is logged in. Refresh
  // the JWT-backed session once on entry so the picker uses the current
  // database assignments instead of the campaignIds cached at sign-in.
  useEffect(() => {
    if (status !== 'authenticated' || campaignAccessRefreshed.current) return;
    campaignAccessRefreshed.current = true;
    void updateSession();
  }, [status, updateSession]);

  useEffect(() => {
    const assignedIds = (session?.user as any)?.campaignIds as string[] | undefined;
    const primary = (session?.user as any)?.campaignId as string | undefined;
    if (primary) setCampaignIds([primary]);
    else if (assignedIds?.length) setCampaignIds([assignedIds[0]]);
  }, [session]);

  const normalizedReportDate = reportPeriodType === 'daily'
    ? reportDate
    : reportPeriodType === 'monthly'
      ? `${reportYear}-${String(reportMonth).padStart(2, '0')}-01`
      : `${reportYear}-01-01`;

  const handleImportModeChange = (value: ImportMode) => {
    setImportMode(value);
    if (value === 'single') setMetricType(lastSingleMetric || 'transmittals');
    else setMetricType('all');
  };

  const handleMetricTypeChange = (value: string) => {
    if (value === 'all') return;
    setMetricType(value);
    setLastSingleMetric(value);
  };

  const handleReportPeriodChange = (value: ReportPeriodType) => {
    const dailyDate = reportDate ? new Date(`${reportDate}T00:00:00`) : new Date();
    const safeDailyDate = Number.isNaN(dailyDate.getTime()) ? new Date() : dailyDate;
    const nextYear = reportPeriodType === 'daily' ? safeDailyDate.getFullYear() : reportYear;
    const nextMonth = reportPeriodType === 'daily' ? safeDailyDate.getMonth() + 1 : reportMonth;
    setReportYear(nextYear);
    setReportMonth(nextMonth);
    if (value === 'daily') setReportDate(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01`);
    setReportPeriodType(value);
  };

  const sortedImportDetails = useMemo(
    () =>
      [...(importResult?.details ?? [])].sort((a: any, b: any) =>
        compareDateValues(a.date, b.date, importDateSort)
      ),
    [importResult?.details, importDateSort]
  );
  const assignedCampaignIds: string[] = (session?.user as any)?.campaignIds || [];
  const availableCampaigns = Array.isArray(importHistoryData?.campaigns)
    ? importHistoryData.campaigns
    : assignedCampaignIds.length
      ? campaigns.filter((campaign) => assignedCampaignIds.includes(campaign.id))
      : campaigns;
  const selectedCampaigns = availableCampaigns.filter((campaign) => campaignIds.includes(campaign.id));
  const importFiles = importHistoryData?.imports ?? [];
  const sortedImportFiles = useMemo(
    () =>
      [...importFiles].sort((a, b) =>
        compareDateValues(a.importedAt, b.importedAt, importHistoryDateSort)
      ),
    [importFiles, importHistoryDateSort]
  );

  if (status === 'unauthenticated') {
    router.push('/login');
    return null;
  }

  if (status === 'authenticated') {
    const user = session?.user as any;
    if (user?.role !== 'COLLECTOR') {
      router.push('/dashboard');
      return null;
    }
  }

  if (status === 'loading') return <div className="p-6">Loading...</div>;

  const addFiles = (incoming: File[]) => {
    const accepted: File[] = [];
    const existing = new Set(files.map((item) => `${item.name.toLowerCase()}|${item.size}|${item.lastModified}`));
    for (const selected of incoming) {
      if (!/\.(csv|xlsx|xls)$/i.test(selected.name)) {
        setError(`${selected.name}: only .csv, .xlsx, and .xls files are supported.`);
        continue;
      }
      if (selected.size > 10 * 1024 * 1024) {
        setError(`${selected.name}: file exceeds the 10 MB maximum.`);
        continue;
      }
      const key = `${selected.name.toLowerCase()}|${selected.size}|${selected.lastModified}`;
      if (existing.has(key)) {
        setError(`${selected.name}: duplicate file was not added.`);
        continue;
      }
      existing.add(key);
      accepted.push(selected);
    }
    if (!accepted.length) return;
    const next = [...files, ...accepted];
    setFiles(next);
    setSelectedFileNames(next.map((item) => item.name));
    setError(null);
    const period = detectMTDPeriod(accepted[0].name);
    setDetectedPeriod(period);
    if (period) {
      setReportDate(period.endYmd);
      const [year, month] = period.startYmd.split('-').map(Number);
      setReportYear(year);
      setReportMonth(month);
    }
    if (accepted.some((item) => /bpi.*dashboard|dashboard.*bpi/i.test(item.name))) setReportPeriodType('monthly');
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  };

  const removeFile = (name: string) => {
    setFiles((current) => current.filter((item) => item.name !== name));
    setSelectedFileNames((current) => current.filter((item) => item !== name));
  };

  const handlePreview = async () => {
    if (previewInFlight.current) return;
    const activeFiles = files.filter((item) => selectedFileNames.includes(item.name));
    if (!activeFiles.length) { alert('Please select at least one file'); return; }
    previewInFlight.current = true;
    // A reprocessed file must never inherit review state from an earlier file.
    setSelectedWorksheetKeys([]);
    setWorksheetCampaigns({});
    setProductionPreview(null);
    setProductionCampaignSelections({});
    setProductionBusinessSelections({});
    setWorksheetPreviews([]);
    setWorkbookSummary(null);
    setMatched([]);
    setNewAgents([]);
    setNormalizedPreviewRecords([]);
    setConsolidatedAgentPreviews([]);
    setMonthSummaries([]);
    setStep('previewing');
    setError(null);
    try {
      // Production Monitoring workbooks are campaign/business-unit based, not
      // agent based. Detect that structure first so Campaign and Week columns
      // come directly from the file and no manual campaign selection is needed.
      if (activeFiles.length === 1 && /\.xlsx$/i.test(activeFiles[0].name)) {
        const productionForm = new FormData();
        productionForm.append('file', activeFiles[0]);
        productionForm.append('reportMonth', String(reportMonth));
        productionForm.append('reportYear', String(reportYear));
        const productionResponse = await fetch('/api/production-monitoring/import/preview', { method: 'POST', body: productionForm });
        const productionData = await productionResponse.json();
        if (productionResponse.ok) {
          const detected = productionData as ProductionBulkPreview;
          setProductionPreview(detected);
          setPreviewFiles([{ file: activeFiles[0], index: 0 }]);
          setProductionCampaignSelections(Object.fromEntries(detected.campaignMappings.map((mapping) => [
            mapping.normalizedSource,
            mapping.matchedCampaignId || '__create',
          ])));
          setProductionBusinessSelections(Object.fromEntries(detected.businessUnitMappings.map((mapping) => [
            mapping.key,
            mapping.matchedBusinessUnitId || '__create',
          ])));
          setStep('confirm');
          return;
        }
        // A 422 means this is simply another supported workbook layout; let
        // the existing agent/dashboard import pipeline inspect it next.
        if (productionResponse.status !== 422) {
          throw new Error(productionData.error || 'Production workbook preview failed.');
        }
      }
      if (!campaignIds.length) throw new Error('Select at least one campaign for this workbook. Production Monitoring files detect campaigns automatically.');
      const responses = await Promise.all(activeFiles.map(async (activeFile, index) => {
        const fd = new FormData();
        fd.append('file', activeFile);
        fd.append('mode', 'preview');
        fd.append('importMode', importMode);
        fd.append('metricType', importMode === 'single' ? metricType : 'all');
        fd.append('reportPeriodType', reportPeriodType);
        fd.append('duplicateMode', duplicateMode);
        fd.append('reportDate', normalizedReportDate);
        fd.append('reportMonth', String(reportMonth));
        fd.append('reportYear', String(reportYear));
        fd.append('campaignIds', JSON.stringify(campaignIds));
        if (campaignIds.length === 1) fd.append('campaignId', campaignIds[0]);
        const period = detectMTDPeriod(activeFile.name);
        if (period) { fd.append('periodStart', period.startYmd); fd.append('periodEnd', period.endYmd); }
        const res = await fetch('/api/collectors/bulk-import', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(`${activeFile.name}: ${data.error || 'Preview failed'}`);
        return { data, file: activeFile, index };
      }));
      setPreviewFiles(responses.map(({ file: previewFile, index }) => ({ file: previewFile, index })));
      setMatched(responses.flatMap(({ data, file: previewFile }) => (data.matched || []).map((row: any) => ({ ...row, fileName: previewFile.name }))));
      setNewAgents(responses.flatMap(({ data, file: previewFile }) => (data.notFound || []).map((row: any) => ({ ...row, fileName: previewFile.name }))).map((a: any) => ({ ...a, volume: a.volume ?? 0, approved: true })));
      setNormalizedPreviewRecords(responses.flatMap(({ data, file: previewFile }) => (data.previewRecords || []).map((row: NormalizedPreviewRecord) => ({ ...row, fileName: previewFile.name }))));
      setConsolidatedAgentPreviews(responses.flatMap(({ data, file: previewFile }) =>
        (data.consolidatedAgents || []).map((row: ConsolidatedAgentPreview) => ({ ...row, fileName: previewFile.name }))
      ));
      const combinedMonths = new Map<string, MonthImportSummary>();
      for (const { data } of responses) {
        for (const month of (data.monthSummary || []) as MonthImportSummary[]) {
          const current = combinedMonths.get(month.month) || { ...month, new: 0, existing: 0, invalid: 0 };
          current.new += month.new;
          current.existing += month.existing;
          current.invalid += month.invalid;
          combinedMonths.set(month.month, current);
        }
      }
      setMonthSummaries([...combinedMonths.values()].sort((a, b) => a.month.localeCompare(b.month)));
      const summaries = responses.map(({ data }) => data.workbookSummary).filter(Boolean);
      setWorkbookSummary(summaries.length ? {
        totalWorksheets: summaries.reduce((n, s) => n + s.totalWorksheets, 0),
        worksheetsAccepted: summaries.reduce((n, s) => n + s.worksheetsAccepted, 0),
        worksheetsSkipped: summaries.reduce((n, s) => n + s.worksheetsSkipped, 0),
        totalValidRecords: summaries.reduce((n, s) => n + s.totalValidRecords, 0),
        totalInvalidRecords: summaries.reduce((n, s) => n + s.totalInvalidRecords, 0),
        totalDuplicateRecords: summaries.reduce((n, s) => n + s.totalDuplicateRecords, 0),
        totalUnmappedRecords: summaries.reduce((n, s) => n + (s.totalUnmappedRecords || 0), 0),
        workbookYear: summaries.map((s) => s.workbookYear).filter(Boolean).sort().at(-1),
        supportedWorksheets: [...new Set(summaries.flatMap((s) => s.supportedWorksheets || []))],
        unsupportedWorksheets: [...new Set(summaries.flatMap((s) => s.unsupportedWorksheets || []))],
        detectedMonths: [...new Set(summaries.flatMap((s) => s.detectedMonths || []))],
        detectedCategories: [...new Set(summaries.flatMap((s) => s.detectedCategories || []))],
        detectedMetrics: [...new Set(summaries.flatMap((s) => s.detectedMetrics || []))],
        agentCount: summaries.reduce((n, s) => n + (s.agentCount || 0), 0),
        teamLeaderCount: summaries.reduce((n, s) => n + (s.teamLeaderCount || 0), 0),
        manpowerRecordCount: summaries.reduce((n, s) => n + (s.manpowerRecordCount || 0), 0),
        detectedWorksheet: summaries.map((s) => s.detectedWorksheet).find(Boolean),
        finalFcTotal: summaries.reduce((n, s) => n + (s.finalFcTotal || 0), 0),
        finalBcTotal: summaries.reduce((n, s) => n + (s.finalBcTotal || 0), 0),
        wholeYearTotalFc: summaries.reduce((n, s) => n + (s.wholeYearTotalFc || 0), 0),
        wholeYearTotalBc: summaries.reduce((n, s) => n + (s.wholeYearTotalBc || 0), 0),
        campaignDistribution: summaries.flatMap((s) => s.campaignDistribution || []),
      } : null);
      const sheets = responses.flatMap(({ data, file: previewFile, index }) =>
        (data.worksheetPreviews || []).map((sheet: WorksheetPreview) => ({ ...sheet, key: `${index}::${sheet.key}`, fileName: previewFile.name }))
      );
      const initialMappings: WorksheetCampaignMappings = Object.fromEntries(
        sheets.map((sheet: WorksheetPreview) => [
          sheet.key,
          sheet.campaignMapping === 'unresolved' || sheet.campaignMapping === 'record'
            ? []
            : sheet.campaignId
              ? [sheet.campaignId]
              : campaignIds[0]
                ? [campaignIds[0]]
                : [],
        ])
      );
      setWorksheetPreviews(sheets);
      setWorksheetCampaigns(initialMappings);
      setSelectedWorksheetKeys(sheets.filter((sheet: WorksheetPreview) => sheet.selected && isWorksheetEligible(sheet, initialMappings)).map((sheet: WorksheetPreview) => sheet.key));
      setStep('confirm');
    } catch (err) {
      setError(String(err));
      setStep('configure');
    } finally {
      previewInFlight.current = false;
    }
  };

  const toggleAgentApproval = (target: NewAgent) => {
    setNewAgents(prev => prev.map((agent) => agent === target ? { ...agent, approved: !agent.approved } : agent));
  };

  const toggleWorksheet = (key: string) => {
    const sheet = worksheetPreviews.find((item) => item.key === key);
    if (!sheet || !isWorksheetEligible(sheet, worksheetCampaigns)) return;
    setSelectedWorksheetKeys((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const handleWorksheetCampaignChange = (sheet: WorksheetPreview, mappedCampaignIds: string[]) => {
    const allowedIds = new Set(selectedCampaigns.map((campaign) => campaign.id));
    const nextIds = [...new Set(mappedCampaignIds)].filter((campaignId) => allowedIds.has(campaignId));
    const nextMappings = { ...worksheetCampaigns, [sheet.key]: nextIds };
    setWorksheetCampaigns(nextMappings);
    setSelectedWorksheetKeys((current) => {
      const withoutSheet = current.filter((key) => key !== sheet.key);
      return isWorksheetEligible(sheet, nextMappings) ? [...withoutSheet, sheet.key] : withoutSheet;
    });
  };

  const eligibleWorksheets = worksheetPreviews.filter((sheet) => isWorksheetEligible(sheet, worksheetCampaigns));
  const selectedWorksheets = eligibleWorksheets.filter((sheet) => selectedWorksheetKeys.includes(sheet.key));
  const selectedWorksheetIdentities = new Set(selectedWorksheets.map((sheet) => `${sheet.fileName || ''}|${sheet.sheetName}`));
  const rowBelongsToSelectedWorksheet = (row: { fileName?: string; sheet?: string }) =>
    worksheetPreviews.length === 0 || selectedWorksheetIdentities.has(`${row.fileName || ''}|${row.sheet || ''}`);
  const selectedMatched = matched.filter(rowBelongsToSelectedWorksheet);
  const selectedNewAgents = newAgents.filter(rowBelongsToSelectedWorksheet);
  const selectedPreviewRecords = normalizedPreviewRecords.filter(rowBelongsToSelectedWorksheet);
  const approvedNew = selectedNewAgents.filter(a => a.approved);
  const skippedNew = selectedNewAgents.filter(a => !a.approved);
  const selectedWorksheetCount = selectedWorksheets.length;
  const selectedValidWorksheetCount = selectedWorksheets.length;
  const selectedWorksheetSummary = {
    accepted: selectedWorksheets.length,
    skipped: Math.max(0, worksheetPreviews.length - selectedWorksheets.length),
    valid: selectedWorksheets.reduce((total, sheet) => total + sheet.validRows, 0),
    invalid: selectedWorksheets.reduce((total, sheet) => total + sheet.invalidRows, 0),
    duplicates: selectedWorksheets.reduce((total, sheet) => total + sheet.duplicateRows, 0),
  };
  const isKpiPreview = worksheetPreviews.some((sheet) => sheet.metricType === 'kpi');
  const hasAgentReview = matched.length > 0 || newAgents.length > 0;
  const selectedExistingCount = hasAgentReview
    ? selectedMatched.length
    : selectedPreviewRecords.filter((record) => record.status === 'Existing').length;
  const selectedNewCount = hasAgentReview
    ? selectedNewAgents.length
    : selectedPreviewRecords.filter((record) => record.status !== 'Existing').length;
  const recordsToImport = isKpiPreview
    ? selectedWorksheetSummary.valid
    : hasAgentReview
    ? selectedMatched.length + approvedNew.length
    : selectedWorksheetSummary.valid;

  // Right-side metric block for an agent row. ACQ imports carry NTB/supplementary
  // and a seat category; everything else shows the transmittals/volume view.
  const isAcq = (a: { seatCategory?: string; ntb?: number }) => a.seatCategory !== undefined || a.ntb !== undefined;
  const renderMetrics = (a: MatchedAgent | NewAgent) => {
    if (isAcq(a)) {
      return (
        <>
          <p className="text-sm font-semibold text-slate-700">
            NTB: {(a.ntb ?? 0).toLocaleString()} | SUPP: {(a.supplementary ?? 0).toLocaleString()}
          </p>
          {a.seatCategory ? <p className="text-xs text-slate-500">{a.seatCategory}</p> : null}
        </>
      );
    }
    if (a.c2gTxn !== undefined) {
      return (
        <>
          <p className="text-sm font-semibold text-slate-700">
            TRANS: C2G {(a.c2gTxn ?? 0).toLocaleString()} | BT {(a.btTxn ?? 0).toLocaleString()} | BalCon {(a.balconTxn ?? 0).toLocaleString()} | Total {(a.grandTotalTxn ?? 0).toLocaleString()}
          </p>
          <p className="text-xs text-slate-500">
            BILLINGS: C2G ₱{(a.c2gVol ?? 0).toLocaleString()} | BT ₱{(a.btVol ?? 0).toLocaleString()} | BalCon ₱{(a.balconVol ?? 0).toLocaleString()} | Total ₱{(a.grandTotalVol ?? 0).toLocaleString()}
          </p>
        </>
      );
    }
    return (
      <>
        {importMode !== 'single' ? (
          <p className="text-sm font-semibold text-slate-700">
            T: {(a.transmittals ?? 0).toLocaleString()} | A: {(a.approvals ?? 0).toLocaleString()} | B: {(a.booked ?? 0).toLocaleString()}
          </p>
        ) : (
          <p className="text-sm font-semibold text-slate-700">{a.count.toLocaleString()} {METRIC_LABELS[metricType]}</p>
        )}
        {a.volume > 0 && <p className="text-xs text-slate-500">₱{a.volume.toLocaleString()}</p>}
      </>
    );
  };

  const handleProductionCampaignChange = (source: string, targetId: string) => {
    setProductionCampaignSelections((current) => ({ ...current, [source]: targetId }));
    setProductionBusinessSelections((current) => {
      if (!productionPreview) return current;
      const next = { ...current };
      productionPreview.businessUnitMappings
        .filter((mapping) => mapping.campaignNormalized === source)
        .forEach((mapping) => { next[mapping.key] = '__create'; });
      return next;
    });
  };

  const productionWeekValue = (record: ProductionBulkPreviewRecord, week: number) => {
    const value = record[`week${week}` as keyof ProductionBulkPreviewRecord];
    return typeof value === 'number' ? value : null;
  };

  const handleProductionConfirm = async () => {
    if (!productionPreview || !previewFiles[0]?.file) return;
    const unresolvedCampaigns = productionPreview.campaignMappings.filter((mapping) =>
      !productionCampaignSelections[mapping.normalizedSource] ||
      (productionCampaignSelections[mapping.normalizedSource] === '__create' && !productionPreview.canCreateCampaigns)
    );
    if (unresolvedCampaigns.length) {
      setError(`A CEO must map or create the following campaign${unresolvedCampaigns.length === 1 ? '' : 's'} before import: ${unresolvedCampaigns.map((mapping) => mapping.source).join(', ')}.`);
      return;
    }
    const unresolvedBusinessUnits = productionPreview.businessUnitMappings.filter((mapping) => !productionBusinessSelections[mapping.key]);
    if (unresolvedBusinessUnits.length) {
      setError('Review every detected business unit before importing.');
      return;
    }

    setStep('importing');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', previewFiles[0].file);
      fd.append('reportMonth', String(reportMonth));
      fd.append('reportYear', String(reportYear));
      fd.append('campaignMappings', JSON.stringify(productionPreview.campaignMappings.map((mapping) => ({
        source: mapping.normalizedSource,
        targetId: productionCampaignSelections[mapping.normalizedSource] === '__create'
          ? null
          : productionCampaignSelections[mapping.normalizedSource],
      }))));
      fd.append('businessUnitMappings', JSON.stringify(productionPreview.businessUnitMappings.map((mapping) => ({
        campaignSource: mapping.campaignNormalized,
        source: mapping.normalizedSource,
        targetId: productionBusinessSelections[mapping.key] === '__create'
          ? null
          : productionBusinessSelections[mapping.key],
      }))));
      const response = await fetch('/api/production-monitoring/import/commit', { method: 'POST', body: fd });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Production Monitoring import failed.');
      setImportResult({
        productionMonitoring: true,
        importId: data.importId,
        message: `Production Monitoring import completed: ${data.imported || 0} inserted, ${data.updated || 0} updated, ${data.unchanged || 0} unchanged, and ${data.skipped || 0} skipped.`,
        success: data.imported || 0,
        inserted: data.imported || 0,
        updated: data.updated || 0,
        unchanged: data.unchanged || 0,
        skipped: (data.skipped || 0) + (data.unchanged || 0),
        invalid: data.errors || 0,
        errors: [],
        warnings: data.warnings ? [`${data.warnings} workbook validation warning(s) were recorded in the import history.`] : [],
        details: [],
        importedFiles: [previewFiles[0].file.name],
      });
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('confirm');
    }
  };

  const handleConfirmImport = async () => {
    if (!previewFiles.length) return;
    const unresolved = worksheetPreviews.filter((sheet) => selectedWorksheetKeys.includes(sheet.key) && sheet.validRows > 0 && sheet.campaignMapping === 'unresolved' && !worksheetCampaigns[sheet.key]?.length);
    if (unresolved.length) {
      setError('Some worksheets could not be matched to the selected campaigns. Please review the campaign mapping.');
      return;
    }
    setStep('importing');
    setError(null);
    try {
      const results = [];
      for (const { file: activeFile, index } of previewFiles) {
        const fd = new FormData();
        fd.append('file', activeFile);
        fd.append('mode', 'import');
        fd.append('importMode', importMode);
        fd.append('metricType', importMode === 'single' ? metricType : 'all');
        fd.append('reportPeriodType', reportPeriodType);
        fd.append('duplicateMode', duplicateMode);
        fd.append('reportDate', normalizedReportDate);
        fd.append('reportMonth', String(reportMonth));
        fd.append('reportYear', String(reportYear));
        fd.append('campaignIds', JSON.stringify(campaignIds));
        if (campaignIds.length === 1) fd.append('campaignId', campaignIds[0]);
        const period = detectMTDPeriod(activeFile.name);
        if (period) { fd.append('periodStart', period.startYmd); fd.append('periodEnd', period.endYmd); }
        fd.append('confirmedNewAgents', JSON.stringify(approvedNew.map(a => a.name)));
        fd.append('selectedWorksheetKeys', JSON.stringify(selectedWorksheetKeys.filter((key) => key.startsWith(`${index}::`)).map((key) => key.slice(key.indexOf('::') + 2))));
        fd.append('campaignMappings', JSON.stringify(Object.fromEntries(Object.entries(worksheetCampaigns).filter(([key]) => key.startsWith(`${index}::`)).map(([key, value]) => [key.slice(key.indexOf('::') + 2), value]))));
        const res = await fetch('/api/collectors/bulk-import', { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(`${activeFile.name}: ${data.error || 'Import failed'}`);
        results.push(data);
      }
      const insertedTotal = results.reduce((n, r) => n + (r.inserted || 0), 0);
      const skippedTotal = results.reduce((n, r) => n + (r.skipped || 0), 0);
      const invalidTotal = results.reduce((n, r) => n + (r.invalid || 0), 0);
      const importedCampaignIds = [...new Set(results.flatMap((result) => result.importedCampaignIds || []))];
      setImportResult({
        message: `Import completed for ${importedCampaignIds.length} campaign${importedCampaignIds.length === 1 ? '' : 's'}: ${insertedTotal} inserted, ${skippedTotal} skipped, and ${invalidTotal} invalid across ${results.length} file(s).`,
        success: insertedTotal,
        created: results.reduce((n, r) => n + (r.created || 0), 0),
        inserted: insertedTotal,
        updated: results.reduce((n, r) => n + (r.updated || 0), 0),
        normalizedImported: results.reduce((n, r) => n + (r.normalizedImported || 0), 0),
        normalizedDuplicates: results.reduce((n, r) => n + (r.normalizedDuplicates || 0), 0),
        skipped: skippedTotal,
        invalid: invalidTotal,
        errors: results.flatMap((r) => r.errors || []),
        warnings: results.flatMap((r) => r.warnings || []),
        details: results.flatMap((r) => r.details || []),
        importedFiles: previewFiles.map((item) => item.file.name),
        detectedWorksheets: [...new Set(results.flatMap((r) => r.workbookSummary?.supportedWorksheets || []))],
        agentRows: results.reduce((n, r) => n + (r.workbookSummary?.agentCount || 0), 0),
        finalFcTotal: results.reduce((n, r) => n + (r.workbookSummary?.finalFcTotal || 0), 0),
        finalBcTotal: results.reduce((n, r) => n + (r.workbookSummary?.finalBcTotal || 0), 0),
        wholeYearTotalFc: results.reduce((n, r) => n + (r.workbookSummary?.wholeYearTotalFc || 0), 0),
        wholeYearTotalBc: results.reduce((n, r) => n + (r.workbookSummary?.wholeYearTotalBc || 0), 0),
      });
      setStep('done');
      mutateImportHistory();

      // If this collector had no campaign before, the import just assigned one.
      // Refresh the session so the dashboard picks it up without a re-login.
      if (!(session?.user as any)?.campaignId) {
        try { await updateSession(); } catch { /* non-blocking */ }
      }
    } catch (err) {
      setError(String(err));
      setStep('confirm');
    }
  };

  const handleReset = () => {
    setFiles([]);
    setSelectedFileNames([]);
    setPreviewFiles([]);
    setNormalizedPreviewRecords([]);
    setConsolidatedAgentPreviews([]);
    setMonthSummaries([]);
    setProductionPreview(null);
    setProductionCampaignSelections({});
    setProductionBusinessSelections({});
    setMatched([]);
    setNewAgents([]);
    setWorksheetPreviews([]);
    setWorkbookSummary(null);
    setSelectedWorksheetKeys([]);
    setWorksheetCampaigns({});
    setImportResult(null);
    setError(null);
    setDetectedPeriod(null);
    setStep('configure');
  };

  const downloadTemplate = () => {
    let csv: string;
    if (metricType === 'acq') {
      // ACQ raw format: AGENT CODE | LAST/FIRST NAME | DATE ONBOARD | SEAT CATEGORY | TOTAL + per-date NTB/SUPPLEMENTARY pairs
      csv = [
        `AGENT CODE,LAST NAME,FIRST NAME,DATE ONBOARD,SEAT CATEGORY,TOTAL,,2026-04-21,`,
        `,,,,,NTB,SUPPLEMENTARY,NTB,SUPPLEMENTARY`,
        `TAXH,ADLAON,EDZEL,2024-02-05,BILLABLE,43,22,1,1`,
        `TAAD,AGUILAR,REDJEAN,2021-05-27,BILLABLE,35,18,0,0`,
        `TBGK,BUHAIN,EDMAR,2026-04-06,BUFFER,18,6,0,0`,
      ].join('\n');
    } else if (metricType === 'all' || metricType === 'all_metrics') {
      // Format with separate columns for each metric type
      csv = [
        `,BPI,LEVEL,TRANSMITTED,APPROVALS,BOOKED,VOLUME`,
        `,FULL NAME`,
        `1,DELA CRUZ JUAN SANTOS,CORE,50,45,30,1234567.00`,
        `2,REYES MARIA GRACE SANTOS,CORE,35,32,20,987654.00`,
        `3,CABALLERO PEDRO JOSE III,ROOKIE I,20,18,12,543210.00`,
        `4,MENDOZA ANA PATRICIA,ROOKIE I,15,14,8,321000.00`,
      ].join('\n');
    } else {
      // Single COUNT column for specific metric
      csv = [
        `,BPI,LEVEL,COUNT,VOLUME`,
        `,FULL NAME`,
        `1,DELA CRUZ JUAN SANTOS,CORE,50,1234567.00`,
        `2,REYES MARIA GRACE SANTOS,CORE,35,987654.00`,
        `3,CABALLERO PEDRO JOSE III,ROOKIE I,20,543210.00`,
        `4,MENDOZA ANA PATRICIA,ROOKIE I,15,321000.00`,
      ].join('\n');
    }
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = metricType === 'acq' ? 'acq-import-template.csv' : 'bpi-pa-import-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const downloadErrorReport = () => {
    const rows = (importResult?.errors || []).map((message: string) => {
      const match = message.match(/^(.*?) row (\d+):\s*(.*)$/);
      return [previewFiles[0]?.file.name || '', match?.[1] || '', match?.[2] || '', '', match?.[3] || message];
    });
    const escape = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [['File name', 'Worksheet', 'Row number', 'Original row data', 'Validation error'], ...rows].map((row) => row.map(escape).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = 'bulk-import-errors.csv'; anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleViewImport = async (item: ImportFileSummary) => {
    setLoadingImportDetails(true);
    setError(null);
    try {
      const res = await fetch(`/api/collectors/bulk-import?entryId=${item.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load import file');
      setSelectedImport(data.importFile);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingImportDetails(false);
    }
  };

  const handleDeleteImport = async () => {
    if (!deleteTarget) return;

    setDeletingImport(true);
    setError(null);
    try {
      const res = await fetch(`/api/collectors/bulk-import?entryId=${deleteTarget.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete import file');
      if (selectedImport?.id === deleteTarget.id) setSelectedImport(null);
      setDeleteTarget(null);
      await mutateImportHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingImport(false);
    }
  };

  // ─── STEP: CONFIGURE ────────────────────────────────────────────────────────
  if (step === 'configure') {
    return (
      <div className="space-y-6 p-6">
        <PageTitle title="Bulk Data Import" subtitle="Upload production dashboards, KPI workbooks, Excel files, or CSV data" />

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Format info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Supported Formats</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-slate-600 space-y-2">
            <p><span className="font-medium text-slate-800">Single Metric (.xlsx) or CSV:</span> Row 1 = BPI/LEVEL/COUNT/VOLUME · Row 2 = FULL NAME · Row 3+ = No. | Full Name | Level | Count | Volume</p>
            <p><span className="font-medium text-slate-800">All Metrics (.xlsx) or CSV:</span> Row 1 = BPI/LEVEL/TRANSMITTED/APPROVALS/BOOKED/VOLUME · Row 2 = FULL NAME · Row 3+ = No. | Full Name | Level | Transmitted | Approvals | Booked | Volume</p>
            <p><span className="font-medium text-slate-800">ACQ (.xlsx) or CSV:</span> AGENT CODE | LAST NAME | FIRST NAME | DATE ONBOARD | SEAT CATEGORY | TOTAL + per-date NTB/SUPPLEMENTARY pairs — reads name from Last + First and the highest NTB &amp; Supplementary per agent</p>
            <p><span className="font-medium text-slate-800">BDO Dashboard (.xlsx/.xls):</span> Automatically scans YTD Performance, Manpower Monitoring, CI/Cross Sell agent and HOH monitoring, and TLs Scorecard worksheets. Merged monthly groups and populated months are detected dynamically.</p>
            <p><span className="font-medium text-slate-800">BDO CCC KPI Workbook (.xlsx):</span> Detects monthly JANâ€“DEC worksheets with merged ACTUALS, GOAL, and ACVT headers, then imports QA, AHT, Adherence, CM, and CD for every populated month.</p>
            <p><span className="font-medium text-slate-800">BPI Dashboard (.xlsx/.xls):</span> Automatically scans YTD Performance, Manpower Monitoring, PA agent/HOH monitoring, PL productivity, and PL HOH monitoring. Campaign sections, month groups, Count, and Volume metrics are mapped independently.</p>
            <p><span className="font-medium text-slate-800">MB PA Monthly Dashboard (.xlsx/.xls):</span> Automatically recognizes month blocks with C2G, BT, and BalCon under TRANS and BILLINGS, including totals, Tier, Target, and Achievement—even when the worksheet is named MOM PROD.</p>
            <p><span className="font-medium text-slate-800">MB ACQ / MB PL Annual Dashboard (.xlsx/.xls):</span> Automatically captures every populated agent/month from merged TARGET, ACTUAL, %, SCORE, and ACHIEVEMENT blocks, including zero values and agent metadata.</p>
            <p><span className="font-medium text-slate-800">Production Monitoring (.xlsx):</span> Automatically detects campaigns, business units, reporting months, and every Week 1â€“Week 5 column present in the workbook. OM-name columns are excluded before preview and import.</p>
            <p className="text-xs text-slate-400">For single metric mode, the COUNT column is stored as the selected type. For all metrics mode, each column is stored separately. Use the Report Month picker to set the period.</p>
            <Button onClick={downloadTemplate} variant="outline" size="sm" className="gap-2 mt-1">
              <Download className="h-4 w-4" /> Download CSV Template
            </Button>
          </CardContent>
        </Card>

        {/* Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Import Settings</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Import Mode</label>
              <select
                value={importMode}
                onChange={e => handleImportModeChange(e.target.value as ImportMode)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">Import All Data (Recommended)</option>
                <option value="worksheets">Import Selected Worksheets</option>
                <option value="single">Import Single Metric</option>
              </select>
              <p className="text-xs text-slate-500">All Data detects supported worksheets and metrics automatically.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Campaign</label>
              <CampaignMultiSelect campaigns={availableCampaigns} value={campaignIds} onChange={setCampaignIds} placeholder="Select one or more campaigns..." />
              <p className="text-xs text-slate-500">Optional for Production Monitoring files because campaigns are detected from the workbook. Required for other formats.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">
                Metric Type
              </label>
              <select
                value={metricType}
                onChange={e => handleMetricTypeChange(e.target.value)}
                disabled={importMode !== 'single'}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all" disabled={importMode === 'single'}>ALL METRICS</option>
                <option value="transmittals">Transmitted</option>
                <option value="approvals">Approvals</option>
                <option value="booked">Booked</option>
                <option value="activations">Activations</option>
                <option value="acq">ACQ (NTB &amp; Supplementary)</option>
              </select>
              <p className="text-xs text-slate-500">
                {importMode !== 'single'
                  ? 'Automatically detected from each worksheet'
                  : metricType === 'acq'
                  ? 'Highest NTB & Supplementary per agent stored, with seat category (BILLABLE/BUFFER)'
                  : `The COUNT column will be stored as ${METRIC_LABELS[metricType]}`}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Report Period</label>
              <select value={reportPeriodType} onChange={(event) => handleReportPeriodChange(event.target.value as ReportPeriodType)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="daily">Daily</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option>
              </select>
              <p className="text-xs text-slate-500">Controls how the reporting date is normalized.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Duplicate Handling</label>
              <select value={duplicateMode} onChange={(event) => setDuplicateMode(event.target.value as DuplicateMode)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="skip">Skip Existing Records</option>
                <option value="update">Update Existing Records</option>
                <option value="replace_period">Replace Matching Period Data</option>
              </select>
              <p className="text-xs text-slate-500">Applied using campaign, source, entity, metric, month, and year.</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">{reportPeriodType === 'daily' ? 'Report Date' : reportPeriodType === 'monthly' ? 'Report Month' : 'Report Year'}</label>
              {reportPeriodType === 'daily' ? (
                <input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              ) : reportPeriodType === 'monthly' ? (
                <input type="month" value={`${reportYear}-${String(reportMonth).padStart(2, '0')}`} onChange={(event) => { const [year, month] = event.target.value.split('-').map(Number); setReportYear(year); setReportMonth(month); }} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              ) : (
                <select value={reportYear} onChange={(event) => setReportYear(Number(event.target.value))} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {Array.from({ length: 11 }, (_, index) => new Date().getFullYear() + 5 - index).map((year) => <option key={year} value={year}>{year}</option>)}
                </select>
              )}
              <p className="text-xs text-slate-500">{reportPeriodType === 'daily' ? 'Use this date for daily trends and reporting.' : reportPeriodType === 'monthly' ? 'Select the reporting month.' : 'Select the reporting year.'}</p>
            </div>
          </CardContent>
        </Card>

        {/* File upload */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Select File</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div
              className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-500 transition"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }}
            >
              <input type="file" accept=".csv,.xlsx,.xls" multiple onChange={handleFileChange} className="hidden" id="file-input" />
              <label htmlFor="file-input" className="cursor-pointer block">
                <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                <p className="text-sm font-medium text-slate-700">
                  {files.length ? `${files.length} file(s) selected` : 'Click to select or drag & drop'}
                </p>
                <p className="text-xs text-slate-500 mt-1">.csv or .xlsx · max 10 MB</p>
              </label>
            </div>
            {files.length > 0 && (
              <div className="text-sm rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-800">
                {detectedPeriod
                  ? <>Detected MTD period: <span className="font-semibold">{detectedPeriod.label}</span></>
                  : <>Could not detect a month in the filename — set the Report Date manually above.</>}
              </div>
            )}
            {files.length > 0 && (
              <div className="space-y-2 rounded-lg border p-3">
                {files.length > 1 && (
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                    <input type="checkbox" checked={selectedFileNames.length === files.length} onChange={(event) => setSelectedFileNames(event.target.checked ? files.map((item) => item.name) : [])} className="h-4 w-4 accent-blue-600" />
                    Select All Files
                  </label>
                )}
                {files.map((item) => (
                  <div key={`${item.name}-${item.lastModified}`} className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm">
                    <input type="checkbox" checked={selectedFileNames.includes(item.name)} onChange={() => setSelectedFileNames((current) => current.includes(item.name) ? current.filter((name) => name !== item.name) : [...current, item.name])} className="h-4 w-4 accent-blue-600" />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="text-xs text-slate-400">{(item.size / 1024 / 1024).toFixed(2)} MB</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeFile(item.name)} aria-label={`Remove ${item.name}`}><X className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => { setFiles([]); setSelectedFileNames([]); }}>Clear All Files</Button>
              </div>
            )}
            <Button onClick={handlePreview} disabled={selectedFileNames.length === 0} className="w-full gap-2">
              <Upload className="h-4 w-4" />
              {importMode === 'single' ? 'Preview Import' : 'Preview All Data'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  Imported Files
                </CardTitle>
                <CardDescription>Review imported batches, see when they were uploaded, and delete a batch if needed.</CardDescription>
              </div>
              <span className="text-xs font-medium text-muted-foreground">{sortedImportFiles.length} file(s)</span>
            </div>
          </CardHeader>
          <CardContent>
            {sortedImportFiles.length === 0 ? (
              <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                No imported files yet.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/60 text-left text-muted-foreground">
                    <tr>
                      <th className="p-2 font-medium">File</th>
                      <th className="p-2 font-medium">Campaign</th>
                      <th className="p-2 font-medium">
                        <SortableDateHeader
                          label="Imported"
                          direction={importHistoryDateSort}
                          onToggle={() => setImportHistoryDateSort((direction) => (direction === 'asc' ? 'desc' : 'asc'))}
                        />
                      </th>
                      <th className="p-2 font-medium">Report Date</th>
                      <th className="p-2 text-right font-medium">Records</th>
                      <th className="p-2 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedImportFiles.map((item, index) => (
                      <tr key={item.id} className={index % 2 === 0 ? 'bg-card' : 'bg-muted/30'}>
                        <td className="max-w-[260px] p-2">
                          <p className="truncate font-medium text-foreground">{item.fileName}</p>
                          <p className="text-xs capitalize text-muted-foreground">{metricLabel(item.metricType)}</p>
                        </td>
                        <td className="p-2">{item.campaignName}</td>
                        <td className="p-2">{formatDateTime(item.importedAt)}</td>
                        <td className="p-2">
                          <p>{formatDate(item.reportDate)}</p>
                          {item.periodStart && item.periodEnd && (
                            <p className="text-xs text-muted-foreground">
                              {formatDate(item.periodStart)} - {formatDate(item.periodEnd)}
                            </p>
                          )}
                        </td>
                        <td className="p-2 text-right">{item.detailCount.toLocaleString()}</td>
                        <td className="p-2">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1"
                              onClick={() => handleViewImport(item)}
                              disabled={loadingImportDetails}
                            >
                              <Eye className="h-4 w-4" />
                              View
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="gap-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/60 dark:hover:text-red-300"
                              onClick={() => setDeleteTarget(item)}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={Boolean(selectedImport)} onOpenChange={(open) => !open && setSelectedImport(null)}>
          <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{selectedImport?.fileName}</DialogTitle>
              <DialogDescription>
                Imported {formatDateTime(selectedImport?.importedAt)} into {selectedImport?.campaignName}
              </DialogDescription>
            </DialogHeader>
            {selectedImport && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">Records</p>
                    <p className="text-lg font-semibold">{selectedImport.detailCount.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">Metric</p>
                    <p className="text-lg font-semibold capitalize">{metricLabel(selectedImport.metricType)}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">Volume</p>
                    <p className="text-lg font-semibold">PHP {selectedImport.totals.volume.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">NTB / Supp</p>
                    <p className="text-lg font-semibold">{selectedImport.totals.ntb.toLocaleString()} / {selectedImport.totals.supplementary.toLocaleString()}</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-left text-muted-foreground">
                      <tr>
                        <th className="p-2">Agent</th>
                        <th className="p-2">Card Level</th>
                        <th className="p-2 text-right">Transmitted</th>
                        <th className="p-2 text-right">Approvals</th>
                        <th className="p-2 text-right">Booked</th>
                        <th className="p-2 text-right">Volume</th>
                        <th className="p-2 text-right">NTB</th>
                        <th className="p-2 text-right">Supplementary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...(selectedImport.details ?? [])]
                        .sort((a, b) =>
                          cardLevelRank(a.cardLevel) - cardLevelRank(b.cardLevel) ||
                          a.agent.localeCompare(b.agent)
                        )
                        .map((detail, index) => (
                        <tr key={detail.id} className={index % 2 === 0 ? 'bg-card' : 'bg-muted/30'}>
                          <td className="p-2">
                            <p className="font-medium">{detail.agent}</p>
                            <p className="text-xs text-muted-foreground">
                              {detail.seatNumber ? `Seat ${detail.seatNumber}` : 'No seat'}
                              {detail.seatCategory ? ` - ${detail.seatCategory}` : ''}
                            </p>
                          </td>
                          <td className="p-2">
                            {detail.cardLevel ? (
                              <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${
                                detail.cardLevel === 'FIRST_CARD'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-violet-100 text-violet-800'
                              }`}>
                                {cardLevelLabel(detail.cardLevel, detail.cardLevelLabel)}
                              </span>
                            ) : '-'}
                          </td>
                          <td className="p-2 text-right">{detail.transmittals.toLocaleString()}</td>
                          <td className="p-2 text-right">{detail.approvals.toLocaleString()}</td>
                          <td className="p-2 text-right">{detail.booked.toLocaleString()}</td>
                          <td className="p-2 text-right">PHP {detail.volume.toLocaleString()}</td>
                          <td className="p-2 text-right">{detail.ntb.toLocaleString()}</td>
                          <td className="p-2 text-right">{detail.supplementary.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title="Delete Imported File"
          description={
            <>
              Delete <span className="font-semibold">{deleteTarget?.fileName}</span>? This removes the imported batch and its production records.
            </>
          }
          actionLabel="Delete"
          isDangerous
          isLoading={deletingImport}
          onConfirm={handleDeleteImport}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    );
  }

  // ─── STEP: PREVIEWING ───────────────────────────────────────────────────────
  if (step === 'previewing') {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="text-center space-y-3 text-slate-600">
          <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" />
          <p className="text-sm">Scanning workbook structure and validating data...</p>
        </div>
      </div>
    );
  }

  // ─── STEP: CONFIRM ──────────────────────────────────────────────────────────
  if (step === 'confirm') {
    if (productionPreview) {
      const unresolvedCampaigns = productionPreview.campaignMappings.filter((mapping) =>
        !productionCampaignSelections[mapping.normalizedSource] ||
        (productionCampaignSelections[mapping.normalizedSource] === '__create' && !productionPreview.canCreateCampaigns)
      );
      const unresolvedBusinessUnits = productionPreview.businessUnitMappings.filter((mapping) => !productionBusinessSelections[mapping.key]);
      const readyRecords = productionPreview.records.filter((record) =>
        !record.issues.some((issue) => issue.level === 'ERROR') &&
        !unresolvedCampaigns.some((mapping) => mapping.normalizedSource === record.campaignNormalized)
      );
      const periodLabel = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('en-US', {
        month: 'long', year: 'numeric', timeZone: 'UTC',
      });
      const statusStyle = (status: ProductionBulkPreviewRecord['status']) => {
        if (status === 'ERROR') return 'bg-red-100 text-red-800';
        if (status === 'UPDATED') return 'bg-blue-100 text-blue-800';
        if (status === 'UNCHANGED') return 'bg-slate-100 text-slate-700';
        if (status === 'CONFLICT' || status === 'WARNING') return 'bg-amber-100 text-amber-800';
        return 'bg-green-100 text-green-800';
      };

      return (
        <div className="space-y-6 p-6">
          <PageTitle
            title="Review Production Monitoring Import"
            subtitle="Campaigns, business units, reporting periods, and Week columns were detected from the Excel workbook"
          />

          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <p className="font-semibold">OM names are excluded</p>
            <p className="mt-1 text-emerald-800">OM-name columns and values are not shown in this preview and will not be sent to the database.</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />{error}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              ['Detected', productionPreview.stats.total, 'text-slate-800'],
              ['Valid', productionPreview.stats.valid, 'text-green-700'],
              ['New', productionPreview.stats.new, 'text-emerald-700'],
              ['Updates', productionPreview.stats.updated, 'text-blue-700'],
              ['Unchanged', productionPreview.stats.unchanged, 'text-slate-600'],
              ['Errors', productionPreview.stats.errors, 'text-red-700'],
            ].map(([label, value, color]) => (
              <Card key={String(label)}><CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${color}`}>{Number(value).toLocaleString()}</p>
                <p className="text-xs text-slate-500">{label}</p>
              </CardContent></Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Detected Workbook Structure</CardTitle>
              <CardDescription>The reporting period and Week columns below came directly from {productionPreview.fileName}.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {productionPreview.reportingPeriods.map((period) => (
                <span key={`${period.year}-${period.month}`} className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-800">{periodLabel(period.year, period.month)}</span>
              ))}
              {productionPreview.detectedWeeks.map((week) => (
                <span key={week} className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-800">Week {week}</span>
              ))}
              <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">OM names excluded</span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Campaign Mapping</CardTitle>
              <CardDescription>Detected campaigns are matched automatically. Unknown campaigns must be mapped to an assigned campaign; only a CEO can create a new campaign.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {productionPreview.campaignMappings.map((mapping) => {
                const selected = productionCampaignSelections[mapping.normalizedSource] || '';
                const unresolved = selected === '__create' && !productionPreview.canCreateCampaigns;
                return (
                  <div key={mapping.normalizedSource} className={`grid gap-2 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_minmax(18rem,1fr)] md:items-center ${unresolved ? 'border-amber-300 bg-amber-50' : ''}`}>
                    <div>
                      <p className="font-medium text-slate-800">{mapping.source}</p>
                      <p className="text-xs text-slate-500">{mapping.suggestion ? `Suggested: ${mapping.suggestion.name} (${mapping.suggestion.confidence}% match)` : `Detection: ${mapping.resolution.toLowerCase()}`}</p>
                    </div>
                    <select value={selected} onChange={(event) => handleProductionCampaignChange(mapping.normalizedSource, event.target.value)} className="w-full rounded-md border bg-white px-3 py-2 text-sm">
                      <option value="">Select campaign...</option>
                      {productionPreview.availableCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
                      <option value="__create" disabled={!productionPreview.canCreateCampaigns}>{productionPreview.canCreateCampaigns ? `Create “${mapping.source}”` : `Needs CEO mapping: “${mapping.source}”`}</option>
                    </select>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Business Unit Mapping</CardTitle>
              <CardDescription>Existing business units are matched automatically. A new business unit can be created inside the mapped campaign.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {productionPreview.businessUnitMappings.map((mapping) => {
                const selectedCampaignId = productionCampaignSelections[mapping.campaignNormalized];
                const unitOptions = productionPreview.availableBusinessUnits.filter((unit) => unit.campaignId === selectedCampaignId);
                const selected = productionBusinessSelections[mapping.key] || '';
                return (
                  <div key={mapping.key} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[minmax(0,1fr)_minmax(18rem,1fr)] md:items-center">
                    <div>
                      <p className="font-medium text-slate-800">{mapping.source}</p>
                      <p className="text-xs text-slate-500">Campaign: {productionPreview.campaignMappings.find((campaign) => campaign.normalizedSource === mapping.campaignNormalized)?.source || mapping.campaignNormalized}{mapping.suggestion ? ` · Suggested: ${mapping.suggestion.name} (${mapping.suggestion.confidence}% match)` : ''}</p>
                    </div>
                    <select value={selected} onChange={(event) => setProductionBusinessSelections((current) => ({ ...current, [mapping.key]: event.target.value }))} className="w-full rounded-md border bg-white px-3 py-2 text-sm">
                      <option value="">Select business unit...</option>
                      {unitOptions.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
                      <option value="__create">Create “{mapping.source}” in mapped campaign</option>
                    </select>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Production Data Preview</CardTitle>
              <CardDescription>{readyRecords.length.toLocaleString()} valid row(s) are ready. No OM field is included.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[34rem] overflow-auto rounded-lg border">
                <table className="min-w-[1200px] text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-left"><tr>
                    <th className="p-2">Campaign</th><th className="p-2">Business Unit</th><th className="p-2">Period</th><th className="p-2">Metric</th><th className="p-2 text-right">Target</th>
                    {productionPreview.detectedWeeks.map((week) => <th key={week} className="p-2 text-right">Week {week}</th>)}
                    <th className="p-2 text-right">MTD</th><th className="p-2 text-right">Achievement</th><th className="p-2 text-right">Run Rate</th><th className="p-2">Status</th><th className="p-2">Validation</th>
                  </tr></thead>
                  <tbody>{productionPreview.records.map((record) => (
                    <tr key={record.rowKey} className="border-t">
                      <td className="p-2 font-medium">{record.campaignSource}</td><td className="p-2">{record.businessUnitSource}</td>
                      <td className="whitespace-nowrap p-2">{record.reportYear && record.reportMonth ? periodLabel(record.reportYear, record.reportMonth) : 'Invalid'}</td>
                      <td className="p-2 capitalize">{record.metricType.replace(/_/g, ' ')}</td><td className="p-2 text-right">{formatProductionMetric(record.target, record.metricType, record.metricUnit)}</td>
                      {productionPreview.detectedWeeks.map((week) => <td key={week} className="p-2 text-right">{formatProductionMetric(productionWeekValue(record, week), record.metricType, record.metricUnit)}</td>)}
                      <td className="p-2 text-right font-medium">{formatProductionMetric(record.mtd, record.metricType, record.metricUnit)}</td><td className="p-2 text-right">{formatAchievement(record.achievement)}</td><td className="p-2 text-right">{formatAchievement(record.runRate)}</td>
                      <td className="p-2"><span className={`rounded-full px-2 py-1 font-medium ${statusStyle(record.status)}`}>{record.status}</span></td><td className="max-w-72 p-2 text-slate-600">{record.issues.map((issue) => issue.message).join(' ') || 'Valid'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="outline" onClick={handleReset} className="gap-2"><ArrowLeft className="h-4 w-4" />Start Over</Button>
            <Button onClick={handleProductionConfirm} disabled={!readyRecords.length || unresolvedCampaigns.length > 0 || unresolvedBusinessUnits.length > 0} className="flex-1 gap-2 bg-green-600 hover:bg-green-700">
              <CheckCircle className="h-4 w-4" />Import {readyRecords.length.toLocaleString()} Valid Production Row{readyRecords.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      );
    }

    const previewRows: any[] = normalizedPreviewRecords.length ? normalizedPreviewRecords.map((row) => ({
      ...row, name: row.agent, agentName: row.agent, previewStatus: row.status,
    })) : [
      ...matched.map((row) => ({ ...row, previewStatus: 'Valid', validationMessage: '' })),
      ...newAgents.map((row) => ({ ...row, previewStatus: 'Mapping Required', validationMessage: 'Agent not found; approve creation or deselect it.' })),
    ];
    const previewOptions = (key: 'fileName' | 'sheet' | 'campaignName' | 'reportDate' | 'cardLevel' | 'metricType') =>
      [...new Set(previewRows.map((row) => row[key]).filter(Boolean) as string[])].sort();
    const filteredPreviewRows = previewRows
      .filter((row) =>
        (!previewFilter.file || row.fileName === previewFilter.file) &&
        (!previewFilter.sheet || row.sheet === previewFilter.sheet) &&
        (!previewFilter.campaign || row.campaignName === previewFilter.campaign) &&
        (!previewFilter.month || row.reportDate?.slice(0, 7) === previewFilter.month) &&
        (!previewFilter.cardLevel || row.cardLevel === previewFilter.cardLevel) &&
        (!previewFilter.metric || row.metricType === previewFilter.metric) &&
        (!previewFilter.status || row.previewStatus === previewFilter.status)
      )
      .sort((a, b) => cardLevelRank(a.cardLevel) - cardLevelRank(b.cardLevel));
    const cardLevelCounts = previewRows.reduce<Record<string, number>>((counts, row) => {
      if (row.cardLevel) counts[row.cardLevel] = (counts[row.cardLevel] || 0) + 1;
      return counts;
    }, {});
    const showMbPaBreakdown = filteredPreviewRows.some((row) =>
      /\bMB\s*PA\b/i.test(row.campaignName || '') ||
      [row.c2gTxn, row.btTxn, row.balconTxn, row.grandTotalTxn, row.c2gVol, row.btVol, row.balconVol, row.grandTotalVol].some((value) => value != null)
    );
    const previewHeaders = [
      'File', 'Worksheet', 'Campaign', 'Agent', 'Detected Month', 'Report Period', 'Report Date',
      'Card Level', 'Metric', 'Count', 'Volume',
      ...(showMbPaBreakdown ? ['TRANS (C2G / BT / BalCon / Total)', 'BILLINGS (C2G / BT / BalCon / Total)'] : []),
      'Goal', 'Actual', 'Achievement', 'Status', 'Validation Message',
    ];
    return (
      <div className="space-y-6 p-6">
        <PageTitle title="Review Before Import" subtitle="Confirm the agents and data before saving" />

        {detectedPeriod && (
          <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <span>Importing as MTD period: <span className="font-semibold">{detectedPeriod.label}</span></span>
            <span className="text-xs text-blue-600">Report date: {reportDate}</span>
          </div>
        )}

        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <p className="font-medium">Selected campaigns ({selectedCampaigns.length})</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selectedCampaigns.map((campaign) => <span key={campaign.id} className="rounded-full bg-white px-2 py-1 text-xs font-medium text-blue-700">{campaign.campaignName}</span>)}
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Summary banner */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{selectedExistingCount}</p>
            <p className="text-xs text-green-600 mt-1">Existing Agents</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-amber-700">{selectedNewCount}</p>
            <p className="text-xs text-amber-600 mt-1">New Agents Found</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-blue-700">{recordsToImport}</p>
            <p className="text-xs text-blue-600 mt-1">Will Be Imported</p>
          </div>
        </div>

        {workbookSummary && (
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-lg">Workbook Summary</CardTitle>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedWorksheetKeys(eligibleWorksheets.map((sheet) => sheet.key))}>Select All</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setSelectedWorksheetKeys([])}>Clear All</Button>
                </div>
              </div>
              <CardDescription>
                {selectedWorksheetCount} worksheet(s) selected automatically from the import-ready results. Worksheets requiring review remain unchecked until their validation or campaign mapping is resolved.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4 xl:grid-cols-8">
                <div className="rounded-lg border bg-slate-50 p-3 text-center">
                  <p className="text-lg font-semibold">{workbookSummary.totalWorksheets}</p>
                  <p className="text-xs text-slate-500">Worksheets</p>
                </div>
                <div className="rounded-lg border bg-blue-50 p-3 text-center">
                  <p className="text-lg font-semibold text-blue-700">{selectedWorksheetCount}</p>
                  <p className="text-xs text-blue-600">Selected</p>
                </div>
                <div className="rounded-lg border bg-green-50 p-3 text-center">
                  <p className="text-lg font-semibold text-green-700">{selectedWorksheetSummary.accepted}</p>
                  <p className="text-xs text-green-600">Accepted</p>
                </div>
                <div className="rounded-lg border bg-slate-50 p-3 text-center">
                  <p className="text-lg font-semibold">{selectedWorksheetSummary.skipped}</p>
                  <p className="text-xs text-slate-500">Skipped</p>
                </div>
                <div className="rounded-lg border bg-blue-50 p-3 text-center">
                  <p className="text-lg font-semibold text-blue-700">{selectedWorksheetSummary.valid}</p>
                  <p className="text-xs text-blue-600">Valid</p>
                </div>
                <div className="rounded-lg border bg-red-50 p-3 text-center">
                  <p className="text-lg font-semibold text-red-700">{selectedWorksheetSummary.invalid}</p>
                  <p className="text-xs text-red-600">Invalid</p>
                </div>
                <div className="rounded-lg border bg-amber-50 p-3 text-center">
                  <p className="text-lg font-semibold text-amber-700">{selectedWorksheetSummary.duplicates}</p>
                  <p className="text-xs text-amber-600">Duplicates</p>
                </div>
                <div className="rounded-lg border bg-orange-50 p-3 text-center">
                  <p className="text-lg font-semibold text-orange-700">{workbookSummary.totalUnmappedRecords || 0}</p>
                  <p className="text-xs text-orange-600">Unmapped</p>
                </div>
              </div>

              {workbookSummary.detectedWorksheet && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-slate-800">
                    Consolidated card totals · {workbookSummary.detectedWorksheet}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                      <p className="text-xs text-blue-700">Final FC Total</p>
                      <p className="text-xl font-bold text-blue-800">{Number(workbookSummary.finalFcTotal || 0).toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg border border-violet-200 bg-violet-50 p-3">
                      <p className="text-xs text-violet-700">Final BC Total</p>
                      <p className="text-xl font-bold text-violet-800">{Number(workbookSummary.finalBcTotal || 0).toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
                      <p className="text-xs text-sky-700">Whole-Year Total FC</p>
                      <p className="text-xl font-bold text-sky-800">{Number(workbookSummary.wholeYearTotalFc || 0).toLocaleString()}</p>
                    </div>
                    <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
                      <p className="text-xs text-purple-700">Whole-Year Total BC</p>
                      <p className="text-xl font-bold text-purple-800">{Number(workbookSummary.wholeYearTotalBc || 0).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              )}

              {workbookSummary.supportedWorksheets && (
                <div className="grid gap-3 rounded-lg border bg-slate-50 p-4 text-sm md:grid-cols-2 xl:grid-cols-4">
                  <div><p className="font-medium text-slate-700">Workbook Year</p><p className="text-slate-600">{workbookSummary.workbookYear || 'Default report year'}</p></div>
                  <div><p className="font-medium text-slate-700">Detected People</p><p className="text-slate-600">{workbookSummary.agentCount || 0} agents · {workbookSummary.teamLeaderCount || 0} team leaders</p></div>
                  <div><p className="font-medium text-slate-700">Manpower Records</p><p className="text-slate-600">{(workbookSummary.manpowerRecordCount || 0).toLocaleString()}</p></div>
                  <div><p className="font-medium text-slate-700">Detected Months</p><p className="text-slate-600">{workbookSummary.detectedMonths?.join(', ') || 'None'}</p></div>
                  <div className="md:col-span-2"><p className="font-medium text-slate-700">Supported Worksheets</p><p className="text-slate-600">{workbookSummary.supportedWorksheets.join(', ') || 'None'}</p></div>
                  <div className="md:col-span-2"><p className="font-medium text-slate-700">Skipped Worksheets</p><p className="text-slate-600">{workbookSummary.unsupportedWorksheets?.join(', ') || 'None'}</p></div>
                  <div className="md:col-span-2"><p className="font-medium text-slate-700">Categories</p><p className="text-slate-600">{workbookSummary.detectedCategories?.join(', ') || 'None'}</p></div>
                  <div className="md:col-span-2"><p className="font-medium text-slate-700">Metrics</p><p className="text-slate-600">{workbookSummary.detectedMetrics?.join(', ') || 'None'}</p></div>
                </div>
              )}

              {Boolean(workbookSummary.campaignDistribution?.length) && (
                <div className="space-y-2 rounded-lg border p-4">
                  <p className="font-semibold text-slate-800">Campaign Distribution</p>
                  <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {workbookSummary.campaignDistribution!.map((item, index) => (
                      <div key={`${item.campaignId}-${index}`} className="rounded-md border bg-slate-50 p-3 text-xs">
                        <p className="font-semibold text-blue-800">{item.campaignName}</p>
                        <p className="mt-1 text-slate-600">{item.worksheets.join(', ')}</p>
                        <p className="mt-1 text-slate-500">{item.agents} agents · {item.metrics} metrics · {item.records} records</p>
                        <p className="text-slate-500">{item.months.join(', ')}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-2">
                {worksheetPreviews.map((sheet) => {
                  const checked = selectedWorksheetKeys.includes(sheet.key);
                  const validationReason = worksheetValidationReason(sheet, worksheetCampaigns);
                  return (
                    <div
                      key={sheet.key}
                      className={`rounded-lg border p-3 text-sm transition ${
                        checked
                          ? 'border-blue-300 bg-blue-50'
                          : validationReason
                            ? 'bg-slate-50'
                            : 'bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={Boolean(validationReason)}
                          onChange={() => toggleWorksheet(sheet.key)}
                          className="mt-1 h-4 w-4 accent-blue-600 disabled:cursor-not-allowed disabled:opacity-50"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-slate-800">{sheet.sheetName}</p>
                            {sheet.hidden && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">Hidden</span>}
                            <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-600">{sheet.format}</span>
                          </div>
                          {sheet.fileName && <p className="mt-1 truncate text-xs font-medium text-blue-700">{sheet.fileName}</p>}
                          <CampaignMultiSelect
                            id={`worksheet-campaigns-${sheet.key.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
                            campaigns={selectedCampaigns}
                            value={worksheetCampaigns[sheet.key] ?? []}
                            onChange={(ids) => handleWorksheetCampaignChange(sheet, ids)}
                            placeholder={sheet.campaignMapping === 'record' ? 'Detected per record — optionally limit campaigns' : 'Select campaign mapping…'}
                            className={`mt-2 [&>button]:min-h-8 [&>button]:px-2 [&>button]:py-1 [&>button]:text-xs ${sheet.campaignMapping === 'unresolved' && !worksheetCampaigns[sheet.key]?.length ? '[&>button]:border-amber-400' : ''}`}
                            maxVisibleChips={2}
                          />
                          <p className="mt-1 text-xs text-slate-500">
                            {worksheetCampaigns[sheet.key]?.length
                              ? `${worksheetCampaigns[sheet.key].length} campaign${worksheetCampaigns[sheet.key].length === 1 ? '' : 's'} selected`
                              : sheet.campaignMapping === 'record'
                                ? 'Campaign detected per record'
                                : 'Campaign mapping required'} ({sheet.campaignMapping === 'sheet' ? 'matched from sheet' : sheet.campaignMapping === 'record' ? 'matched from record data' : sheet.campaignMapping === 'unresolved' ? 'confirmation required' : 'selected campaign'}) · {metricLabel(sheet.metricType)} · {formatDate(sheet.reportDate)}
                          </p>
                          {Boolean(worksheetCampaigns[sheet.key]?.length && worksheetCampaigns[sheet.key].length > 1) && (
                            <p className="mt-1 text-xs text-blue-700">
                              Multiple selections limit this worksheet to those campaigns. Each record still uses its detected campaign; unresolved records are not duplicated.
                            </p>
                          )}
                          <p className="mt-2 text-xs text-slate-600">
                            Rows {sheet.totalRows} · Valid {sheet.validRows} · Invalid {sheet.invalidRows} · Duplicates {sheet.duplicateRows} · Unmapped {sheet.unmappedRows || 0}
                          </p>
                          {Boolean(sheet.detectedMonths?.length) && <p className="mt-1 text-xs text-slate-500">Months: {sheet.detectedMonths!.join(', ')}</p>}
                          {Boolean(sheet.detectedMetrics?.length) && <p className="mt-1 text-xs text-slate-500">Metrics: {sheet.detectedMetrics!.join(', ')}</p>}
                          {Boolean(sheet.detectedCardLevels?.length) && <p className="mt-1 text-xs text-slate-500">Card Levels: {sheet.detectedCardLevels!.map((level) => cardLevelLabel(level)).join(', ')}</p>}
                          {[...sheet.errors, ...sheet.warnings].slice(0, 3).map((message, i) => (
                            <p key={i} className={`mt-1 text-xs ${sheet.errors.includes(message) ? 'text-red-600' : 'text-amber-700'}`}>
                              {message}
                            </p>
                          ))}
                          {validationReason && (
                            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-800">
                              Not selected automatically: {validationReason}
                            </p>
                          )}
                          {!validationReason && !checked && (
                            <p className="mt-2 text-xs text-slate-500">Deselected by the Collector.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {monthSummaries.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Detected Month Summary</CardTitle>
              <CardDescription>
                Automatically processing {monthSummaries[0].label} through {monthSummaries[monthSummaries.length - 1].label} in chronological order.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {monthSummaries.map((month) => (
                  <div key={month.month} className="rounded-lg border bg-slate-50 p-3 text-sm">
                    <p className="font-semibold text-slate-800">{month.label}</p>
                    <p className="mt-1 text-green-700">{month.new.toLocaleString()} new</p>
                    <p className="text-blue-700">{month.existing.toLocaleString()} existing</p>
                    {month.invalid > 0 && <p className="text-red-700">{month.invalid.toLocaleString()} invalid</p>}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {consolidatedAgentPreviews.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">HOH Agent Card Preview</CardTitle>
              <CardDescription>
                Monthly FC and BC values remain separate. A dash marks a blank or unavailable workbook cell; zero remains a true numeric zero.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[32rem] overflow-auto rounded-lg border">
                <table className="min-w-[2600px] text-xs">
                  <thead className="sticky top-0 bg-slate-100 text-left">
                    <tr>
                      <th className="p-2">Nickname</th>
                      <th className="p-2">Full Name</th>
                      {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].flatMap((month) => [
                        <th key={`${month}-fc`} className="p-2 text-right text-blue-700">{month} FC</th>,
                        <th key={`${month}-bc`} className="p-2 text-right text-violet-700">{month} BC</th>,
                      ])}
                      <th className="p-2 text-right">Final FC Total</th>
                      <th className="p-2 text-right">Final BC Total</th>
                      <th className="p-2 text-right">Whole-Year FC</th>
                      <th className="p-2 text-right">Whole-Year BC</th>
                      <th className="p-2 text-right">Ranking</th>
                      <th className="p-2">Validation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consolidatedAgentPreviews.map((agent) => (
                      <tr key={`${agent.fileName}-${agent.sourceSheet}-${agent.sourceRow}`} className="border-t">
                        <td className="p-2 font-medium">{agent.nickname || '-'}</td>
                        <td className="whitespace-nowrap p-2 font-medium">{agent.fullName}</td>
                        {agent.fcMonths.flatMap((fc, index) => {
                          const bc = agent.bcMonths[index];
                          return [
                            <td key={`${index}-fc`} className="p-2 text-right text-blue-700">{fc.available ? fc.value.toLocaleString() : '-'}</td>,
                            <td key={`${index}-bc`} className="p-2 text-right text-violet-700">{bc?.available ? bc.value.toLocaleString() : '-'}</td>,
                          ];
                        })}
                        <td className="p-2 text-right font-semibold text-blue-700">{agent.finalFcTotal.toLocaleString()}</td>
                        <td className="p-2 text-right font-semibold text-violet-700">{agent.finalBcTotal.toLocaleString()}</td>
                        <td className="p-2 text-right font-semibold">{agent.wholeYearTotalFc.toLocaleString()}</td>
                        <td className="p-2 text-right font-semibold">{agent.wholeYearTotalBc.toLocaleString()}</td>
                        <td className="p-2 text-right">{agent.ranking ?? '-'}</td>
                        <td className={agent.validationStatus === 'Warning' ? 'p-2 text-amber-700' : 'p-2 text-green-700'}>
                          {agent.warnings.length ? agent.warnings.join(' ') : agent.validationStatus}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><CardTitle className="text-lg">Data Preview</CardTitle><CardDescription>{filteredPreviewRows.length} of {previewRows.length} normalized records shown</CardDescription></div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setSelectedWorksheetKeys(eligibleWorksheets.map((sheet) => sheet.key))}>Select All Valid Records</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setSelectedWorksheetKeys([])}>Deselect All</Button>
                <label className="flex items-center gap-2 rounded-md border px-3 text-xs font-medium"><input type="checkbox" checked readOnly /> Import Valid Records Only</label>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {Object.keys(cardLevelCounts).length > 0 && (
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
                  <p className="text-xs font-medium text-blue-700">1st Card records</p>
                  <p className="text-lg font-semibold text-blue-900">{(cardLevelCounts.FIRST_CARD || 0).toLocaleString()}</p>
                </div>
                <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2">
                  <p className="text-xs font-medium text-violet-700">Bundle Card records</p>
                  <p className="text-lg font-semibold text-violet-900">{(cardLevelCounts.BUNDLE_CARD || 0).toLocaleString()}</p>
                </div>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
              {[
                ['file', 'File', previewOptions('fileName')], ['sheet', 'Worksheet', previewOptions('sheet')],
                ['campaign', 'Campaign', previewOptions('campaignName')],
                ['month', 'Month', [...new Set(previewOptions('reportDate').map((value) => value.slice(0, 7)))]],
                ['cardLevel', 'Card Level', previewOptions('cardLevel')],
                ['metric', 'Metric', previewOptions('metricType')], ['status', 'Status', [...new Set(previewRows.map((row) => row.previewStatus).filter(Boolean))].sort()],
              ].map(([key, label, values]) => (
                <select key={key as string} value={previewFilter[key as keyof typeof previewFilter]} onChange={(event) => setPreviewFilter((current) => ({ ...current, [key as string]: event.target.value }))} className="rounded-md border px-2 py-2 text-xs">
                  <option value="">All {label as string}s</option>
                  {(values as string[]).map((value) => <option key={value} value={value}>{key === 'cardLevel' ? cardLevelLabel(value) : value}</option>)}
                </select>
              ))}
            </div>
            <div className="max-h-96 overflow-auto rounded-lg border">
              <table className={`w-full ${showMbPaBreakdown ? 'min-w-[1600px]' : 'min-w-[1350px]'} text-xs`}>
                <thead className="sticky top-0 bg-slate-100 text-left"><tr>{previewHeaders.map((label) => <th key={label} className="p-2 font-medium">{label}</th>)}</tr></thead>
                <tbody>{filteredPreviewRows.slice(0, 500).map((row, index) => (
                  <tr key={`${row.fileName}-${row.sheet}-${row.row}-${index}`} className="border-t">
                    <td className="max-w-40 truncate p-2">{row.fileName}</td><td className="p-2">{row.sheet}</td><td className="p-2">{row.campaignName}</td><td className="p-2 font-medium">{'agentName' in row ? row.agentName : row.name}</td><td className="p-2">{monthSummaries.find((month) => month.month === row.reportDate?.slice(0, 7))?.label || row.reportDate?.slice(0, 7) || '-'}</td>
                    <td className="p-2 capitalize">{row.reportPeriodType || reportPeriodType}</td><td className="p-2">{row.reportDate || '-'}</td>
                    <td className="p-2">
                      {row.cardLevel ? (
                        <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 font-medium ${
                          row.cardLevel === 'FIRST_CARD'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-violet-100 text-violet-800'
                        }`}>
                          {cardLevelLabel(row.cardLevel, row.cardLevelLabel)}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="p-2">{metricLabel(row.metricType || metricType)}</td><td className="p-2 text-right">{row.count == null ? '-' : row.count.toLocaleString()}</td><td className="p-2 text-right">{row.volume == null ? '-' : row.volume.toLocaleString()}</td>{showMbPaBreakdown && <><td className="whitespace-nowrap p-2 text-right">{mbPaBreakdown(row, 'trans')}</td><td className="whitespace-nowrap p-2 text-right">{mbPaBreakdown(row, 'billings')}</td></>}<td className="p-2 text-right">{row.goal == null ? '-' : row.goal.toLocaleString()}</td><td className="p-2 text-right">{row.actual == null ? '-' : row.actual.toLocaleString()}</td><td className="p-2 text-right">{row.achievement == null ? '-' : `${(row.achievement * (row.achievement <= 2 ? 100 : 1)).toFixed(1)}%`}</td>
                    <td className={`p-2 font-medium ${row.previewStatus === 'Existing' ? 'text-blue-700' : row.previewStatus === 'Unmapped' ? 'text-orange-700' : 'text-green-700'}`}>{row.previewStatus}</td><td className="p-2 text-slate-500">{row.validationMessage || '-'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* New agents confirmation */}
        {selectedNewAgents.length > 0 && (
          <Card className="border-amber-200">
            <CardHeader>
              <div className="flex items-center gap-2">
                <UserPlus className="h-5 w-5 text-amber-600" />
                <CardTitle className="text-amber-800">New Agents — Approve to Create</CardTitle>
              </div>
              <CardDescription>
                These agents were not found in the campaign. Check the ones you want to create in the database. Unchecked agents will be skipped.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {selectedNewAgents.map((agent, i) => (
                  <label
                    key={i}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition ${
                      agent.approved
                        ? 'bg-amber-50 border-amber-300'
                        : 'bg-slate-50 border-slate-200 opacity-60'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={agent.approved}
                      onChange={() => toggleAgentApproval(agent)}
                      className="h-4 w-4 accent-amber-500"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{agent.name}</p>
                      <p className="text-xs text-slate-500">Will be created as Agent in this campaign</p>
                    </div>
                    <div className="text-right shrink-0">
                      {renderMetrics(agent)}
                    </div>
                  </label>
                ))}
              </div>
              {skippedNew.length > 0 && (
                <p className="text-xs text-slate-500 mt-3">
                  {skippedNew.length} agent(s) unchecked will be skipped and not imported.
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Matched agents */}
        {hasAgentReview && <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-green-600" />
              <CardTitle className="text-green-800">Matched Agents ({selectedMatched.length})</CardTitle>
            </div>
            <CardDescription>These agents were found in the campaign and will be imported.</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedMatched.length === 0 ? (
              <p className="text-sm text-slate-500">No existing agents matched.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1">
                {selectedMatched.map((agent, i) => (
                  <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg bg-green-50 border border-green-100">
                    <div>
                      <p className="text-sm font-medium text-slate-800">{agent.agentName}</p>
                      {agent.name !== agent.agentName && (
                        <p className="text-xs text-slate-400">from file: {agent.name}</p>
                      )}
                    </div>
                    <div className="text-right">
                      {renderMetrics(agent)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>}

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button variant="outline" onClick={handleReset} className="gap-2 sm:w-auto">
            <ArrowLeft className="h-4 w-4" />
            Start Over
          </Button>
          <Button
            onClick={handleConfirmImport}
            disabled={recordsToImport === 0 || (worksheetPreviews.length > 0 && selectedValidWorksheetCount === 0)}
            className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
          >
            <CheckCircle className="h-4 w-4" />
            Import Selected Data{approvedNew.length > 0 ? ` (+ Create ${approvedNew.length} New Agent${approvedNew.length > 1 ? 's' : ''})` : ''}
          </Button>
        </div>
      </div>
    );
  }

  // ─── STEP: IMPORTING ────────────────────────────────────────────────────────
  if (step === 'importing') {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="text-center space-y-3 text-slate-600">
          <div className="animate-spin h-8 w-8 border-4 border-green-500 border-t-transparent rounded-full mx-auto" />
          <p className="text-sm">{productionPreview ? 'Importing Production Monitoring records...' : 'Creating agents and importing records...'}</p>
        </div>
      </div>
    );
  }

  // ─── STEP: DONE ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-6">
      <PageTitle title="Import Complete" subtitle={importResult?.productionMonitoring ? "Production Monitoring data has been saved" : isKpiPreview ? "KPI data has been saved" : "Production data has been saved"} />

      <Card className="border-green-200">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            <CardTitle className="text-green-700">Import Successful</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {importResult?.message && (
            <p className="text-slate-700 font-medium">{importResult.message}</p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-green-700">{importResult?.inserted ?? importResult?.success ?? 0}</p>
              <p className="text-xs text-green-600">Records Inserted</p>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-blue-700">{importResult?.skipped ?? 0}</p>
              <p className="text-xs text-blue-600">Existing Skipped</p>
            </div>
            {importResult?.updated > 0 && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-indigo-700">{importResult.updated}</p>
                <p className="text-xs text-indigo-600">Records Updated</p>
              </div>
            )}
            {importResult?.unmapped > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-orange-700">{importResult.unmapped}</p>
                <p className="text-xs text-orange-600">Unmapped</p>
              </div>
            )}
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
              <p className="text-xl font-bold text-red-700">{importResult?.invalid ?? 0}</p>
              <p className="text-xs text-red-600">Invalid</p>
            </div>
            {importResult?.created > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-amber-700">{importResult.created}</p>
                <p className="text-xs text-amber-600">New Agents Created</p>
              </div>
            )}
            {importResult?.errors?.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                <p className="text-xl font-bold text-red-700">{importResult.errors.length}</p>
                <p className="text-xs text-red-600">Errors</p>
              </div>
            )}
          </div>

          {importResult?.detectedWorksheets?.length > 0 && (
            <div className="space-y-3 rounded-lg border p-4">
              <div className="grid gap-2 text-sm sm:grid-cols-3">
                <p><span className="font-medium">File:</span> {importResult.importedFiles?.join(', ')}</p>
                <p><span className="font-medium">Worksheet:</span> {importResult.detectedWorksheets.join(', ')}</p>
                <p><span className="font-medium">Agent rows:</span> {Number(importResult.agentRows || 0).toLocaleString()}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ['Final FC Total', importResult.finalFcTotal, 'text-blue-700'],
                  ['Final BC Total', importResult.finalBcTotal, 'text-violet-700'],
                  ['Whole-Year Total FC', importResult.wholeYearTotalFc, 'text-sky-700'],
                  ['Whole-Year Total BC', importResult.wholeYearTotalBc, 'text-purple-700'],
                ].map(([label, value, color]) => (
                  <div key={String(label)} className="rounded-md border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className={`text-lg font-bold ${color}`}>{Number(value || 0).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {importResult?.warnings?.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="mb-2 text-sm font-medium text-amber-900">Warnings ({importResult.warnings.length})</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-sm text-amber-800">
                {importResult.warnings.slice(0, 200).map((warning: string, index: number) => <li key={index}>• {warning}</li>)}
              </ul>
            </div>
          )}

          {importResult?.errors?.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <div className="mb-2 flex items-center justify-between gap-2"><p className="text-sm font-medium text-yellow-900">Errors:</p><Button type="button" variant="outline" size="sm" onClick={downloadErrorReport}><Download className="mr-1 h-4 w-4" />Download Error Report</Button></div>
              <ul className="text-sm text-yellow-800 space-y-1 max-h-40 overflow-y-auto">
                {importResult.errors.map((err: string, i: number) => (
                  <li key={i}>• {err}</li>
                ))}
              </ul>
            </div>
          )}

          {importResult?.details?.length > 0 && (
            <div className="overflow-x-auto">
              <table className="text-sm w-full">
                <thead className="bg-slate-100">
                  <tr>
                    <th className="text-left p-2">Agent</th>
                    <th className="text-left p-2">
                      <SortableDateHeader
                        label="Date"
                        direction={importDateSort}
                        onToggle={() => setImportDateSort((direction) => (direction === 'asc' ? 'desc' : 'asc'))}
                      />
                    </th>
                    {isKpiPreview ? (
                      <>
                        <th className="text-right p-2">QA</th>
                        <th className="text-right p-2">AHT</th>
                        <th className="text-right p-2">Adherence</th>
                        <th className="text-right p-2">CM</th>
                        <th className="text-right p-2">CD</th>
                      </>
                    ) : importMode !== 'single' ? (
                      <>
                        <th className="text-right p-2">Transmittals</th>
                        <th className="text-right p-2">Approvals</th>
                        <th className="text-right p-2">Booked</th>
                      </>
                    ) : metricType === 'acq' ? (
                      <>
                        <th className="text-left p-2">Seat</th>
                        <th className="text-right p-2">NTB</th>
                        <th className="text-right p-2">Supplementary</th>
                      </>
                    ) : (
                      <th className="text-right p-2">{METRIC_LABELS[metricType]}</th>
                    )}
                    {!isKpiPreview && metricType !== 'acq' && <th className="text-right p-2">Volume</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedImportDetails.slice(0, 15).map((d: any, i: number) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="p-2">{d.agent}</td>
                      <td className="p-2">{d.date}</td>
                      {isKpiPreview ? (
                        <>
                          <td className="text-right p-2">{d.qa ?? 'â€”'}</td>
                          <td className="text-right p-2">{d.aht ?? 'â€”'}</td>
                          <td className="text-right p-2">{d.adherence ?? 'â€”'}</td>
                          <td className="text-right p-2">{d.cm ?? 'â€”'}</td>
                          <td className="text-right p-2">{d.cd ?? 'â€”'}</td>
                        </>
                      ) : importMode !== 'single' ? (
                        <>
                          <td className="text-right p-2">{(d.transmittals ?? 0).toLocaleString()}</td>
                          <td className="text-right p-2">{(d.approvals ?? 0).toLocaleString()}</td>
                          <td className="text-right p-2">{(d.booked ?? 0).toLocaleString()}</td>
                        </>
                      ) : metricType === 'acq' ? (
                        <>
                          <td className="p-2">{d.seatCategory || '—'}</td>
                          <td className="text-right p-2">{(d.ntb ?? 0).toLocaleString()}</td>
                          <td className="text-right p-2">{(d.supplementary ?? 0).toLocaleString()}</td>
                        </>
                      ) : (
                        <td className="text-right p-2">
                          {(d.transmittals ?? d.approvals ?? d.booked ?? 0).toLocaleString()}
                        </td>
                      )}
                      {!isKpiPreview && metricType !== 'acq' && (
                        <td className="text-right p-2">
                          {d.volume > 0 ? `₱${Number(d.volume).toLocaleString()}` : '—'}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {importResult.details.length > 15 && (
                <p className="text-xs text-slate-500 mt-2">
                  ... and {importResult.details.length - 15} more records
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-2 sm:flex-row">
            {importResult?.productionMonitoring && (
              <Button onClick={() => router.push('/production-monitoring')} className="flex-1 gap-2">
                <Eye className="h-4 w-4" />Open Production Monitoring
              </Button>
            )}
            <Button onClick={handleReset} variant="outline" className="flex-1 gap-2">
              <Upload className="h-4 w-4" />Import Another File
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
