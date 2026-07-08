'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageTitle } from '@/components/layout/page-title';
import { SortableDateHeader, compareDateValues, type DateSortDirection } from '@/components/sortable-date-header';
import { ConfirmDialog } from '@/components/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Upload, AlertCircle, CheckCircle, Download, UserPlus, Users, ArrowLeft, Eye, FileText, Trash2 } from 'lucide-react';

type Step = 'configure' | 'previewing' | 'confirm' | 'importing' | 'done';

interface MatchedAgent {
  name: string;
  count: number;
  volume: number;
  agentId: string;
  agentName: string;
  transmittals?: number;
  approvals?: number;
  booked?: number;
  ntb?: number;
  supplementary?: number;
  seatCategory?: string;
}

interface NewAgent {
  name: string;
  count: number;
  volume: number;
  approved: boolean;
  transmittals?: number;
  approvals?: number;
  booked?: number;
  ntb?: number;
  supplementary?: number;
  seatCategory?: string;
}

interface ImportFileSummary {
  id: string;
  campaignName: string;
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
  }>;
}

const METRIC_LABELS: Record<string, string> = {
  transmittals: 'Transmitted',
  approvals: 'Approvals',
  booked: 'Booked',
  all_metrics: 'All (Transmitted, Approvals, Booked)',
  acq: 'ACQ (NTB & Supplementary)',
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
  const [file, setFile] = useState<File | null>(null);
  const [metricType, setMetricType] = useState('transmittals');
  const [campaigns, setCampaigns] = useState<{ id: string; campaignName: string }[]>([]);
  const [campaignId, setCampaignId] = useState('');
  const [reportDate, setReportDate] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [detectedPeriod, setDetectedPeriod] = useState<{ label: string; startYmd: string; endYmd: string } | null>(null);

  // Flow state
  const [step, setStep] = useState<Step>('configure');
  const [matched, setMatched] = useState<MatchedAgent[]>([]);
  const [newAgents, setNewAgents] = useState<NewAgent[]>([]);
  const [importResult, setImportResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [importDateSort, setImportDateSort] = useState<DateSortDirection>('desc');
  const [importHistoryDateSort, setImportHistoryDateSort] = useState<DateSortDirection>('desc');
  const [selectedImport, setSelectedImport] = useState<ImportFileSummary | null>(null);
  const [loadingImportDetails, setLoadingImportDetails] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ImportFileSummary | null>(null);
  const [deletingImport, setDeletingImport] = useState(false);

  const fetcher = (url: string) => fetch(url).then((res) => res.json());
  const { data: importHistoryData, mutate: mutateImportHistory } = useSWR<{ imports: ImportFileSummary[] }>(
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

  useEffect(() => {
    const assigned = (session?.user as any)?.campaignId;
    if (assigned) setCampaignId(assigned);
  }, [session]);

  const sortedImportDetails = useMemo(
    () =>
      [...(importResult?.details ?? [])].sort((a: any, b: any) =>
        compareDateValues(a.date, b.date, importDateSort)
      ),
    [importResult?.details, importDateSort]
  );
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (!selected.name.endsWith('.csv') && !selected.name.endsWith('.xlsx')) {
      alert('Please select a CSV or Excel file (.csv or .xlsx)');
      return;
    }
    setFile(selected);
    setError(null);

    // Read the MTD reporting period straight from the filename and align the
    // report date to it (period end), so the import is anchored to the file's month.
    const period = detectMTDPeriod(selected.name);
    setDetectedPeriod(period);
    if (period) setReportDate(period.endYmd);
  };

  const handlePreview = async () => {
    if (!file) { alert('Please select a file'); return; }
    if (!campaignId) { alert('Please select a campaign'); return; }
    setStep('previewing');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', 'preview');
      fd.append('metricType', metricType);
      fd.append('reportDate', reportDate);
      fd.append('campaignId', campaignId);
      if (detectedPeriod) {
        fd.append('periodStart', detectedPeriod.startYmd);
        fd.append('periodEnd', detectedPeriod.endYmd);
      }

      const res = await fetch('/api/collectors/bulk-import', { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Preview failed');
        setStep('configure');
        return;
      }

      setMatched(data.matched || []);
      setNewAgents((data.notFound || []).map((a: any) => ({ ...a, volume: a.volume ?? 0, approved: true })));
      setStep('confirm');
    } catch (err) {
      setError(String(err));
      setStep('configure');
    }
  };

  const toggleAgentApproval = (index: number) => {
    setNewAgents(prev => prev.map((a, i) => i === index ? { ...a, approved: !a.approved } : a));
  };

  const approvedNew = newAgents.filter(a => a.approved);
  const skippedNew = newAgents.filter(a => !a.approved);

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
    return (
      <>
        {metricType === 'all_metrics' ? (
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

  const handleConfirmImport = async () => {
    if (!file) return;
    setStep('importing');
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('mode', 'import');
      fd.append('metricType', metricType);
      fd.append('reportDate', reportDate);
      fd.append('campaignId', campaignId);
      if (detectedPeriod) {
        fd.append('periodStart', detectedPeriod.startYmd);
        fd.append('periodEnd', detectedPeriod.endYmd);
      }
      fd.append('confirmedNewAgents', JSON.stringify(approvedNew.map(a => a.name)));

      const res = await fetch('/api/collectors/bulk-import', { method: 'POST', body: fd });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Import failed');
        setStep('confirm');
        return;
      }

      setImportResult(data);
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
    setFile(null);
    setMatched([]);
    setNewAgents([]);
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
    } else if (metricType === 'all_metrics') {
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
        <PageTitle title="Bulk Data Import" subtitle="Upload BPI PA Excel or CSV production data" />

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
          <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Campaign</label>
              <select
                value={campaignId}
                onChange={e => setCampaignId(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a campaign…</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.campaignName}</option>
                ))}
              </select>
              <p className="text-xs text-slate-500">Campaign this data will be imported into</p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">
                Metric Type {metricType === 'all_metrics' ? '(TRANSMITTED/APPROVALS/BOOKED columns)' : metricType === 'acq' ? '(NTB/SUPPLEMENTARY columns)' : '(COUNT column)'}
              </label>
              <select
                value={metricType}
                onChange={e => setMetricType(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="transmittals">Transmitted</option>
                <option value="approvals">Approvals</option>
                <option value="booked">Booked</option>
                <option value="all_metrics">All (Transmitted, Approvals, Booked)</option>
                <option value="acq">ACQ (NTB &amp; Supplementary)</option>
              </select>
              <p className="text-xs text-slate-500">
                {metricType === 'all_metrics'
                  ? 'Transmitted, Approvals, and Booked columns will be stored separately'
                  : metricType === 'acq'
                  ? 'Highest NTB & Supplementary per agent stored, with seat category (BILLABLE/BUFFER)'
                  : `The COUNT column will be stored as ${METRIC_LABELS[metricType]}`}
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-slate-700">Report Date</label>
              <input
                type="date"
                value={reportDate}
                onChange={e => setReportDate(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {detectedPeriod ? (
                <p className="text-xs text-blue-600">MTD period from file: <span className="font-medium">{detectedPeriod.label}</span></p>
              ) : (
                <p className="text-xs text-slate-500">Date this data is as-of (used in daily trends)</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* File upload */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Select File</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-500 transition">
              <input type="file" accept=".csv,.xlsx" onChange={handleFileChange} className="hidden" id="file-input" />
              <label htmlFor="file-input" className="cursor-pointer block">
                <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
                <p className="text-sm font-medium text-slate-700">
                  {file ? file.name : 'Click to select or drag & drop'}
                </p>
                <p className="text-xs text-slate-500 mt-1">.csv or .xlsx · max 10 MB</p>
              </label>
            </div>
            {file && (
              <div className="text-sm rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-blue-800">
                {detectedPeriod
                  ? <>Detected MTD period: <span className="font-semibold">{detectedPeriod.label}</span></>
                  : <>Could not detect a month in the filename — set the Report Date manually above.</>}
              </div>
            )}
            <Button onClick={handlePreview} disabled={!file || !campaignId} className="w-full gap-2">
              <Upload className="h-4 w-4" />
              Preview Import
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <FileText className="h-5 w-5 text-slate-500" />
                  Imported Files
                </CardTitle>
                <CardDescription>Review imported batches, see when they were uploaded, and delete a batch if needed.</CardDescription>
              </div>
              <span className="text-xs font-medium text-slate-500">{sortedImportFiles.length} file(s)</span>
            </div>
          </CardHeader>
          <CardContent>
            {sortedImportFiles.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-500">
                No imported files yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
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
                      <tr key={item.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                        <td className="max-w-[260px] p-2">
                          <p className="truncate font-medium text-slate-900">{item.fileName}</p>
                          <p className="text-xs capitalize text-slate-500">{metricLabel(item.metricType)}</p>
                        </td>
                        <td className="p-2">{item.campaignName}</td>
                        <td className="p-2">{formatDateTime(item.importedAt)}</td>
                        <td className="p-2">
                          <p>{formatDate(item.reportDate)}</p>
                          {item.periodStart && item.periodEnd && (
                            <p className="text-xs text-slate-500">
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
                              className="gap-1 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
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
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Records</p>
                    <p className="text-lg font-semibold">{selectedImport.detailCount.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Metric</p>
                    <p className="text-lg font-semibold capitalize">{metricLabel(selectedImport.metricType)}</p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">Volume</p>
                    <p className="text-lg font-semibold">PHP {selectedImport.totals.volume.toLocaleString()}</p>
                  </div>
                  <div className="rounded-lg border bg-slate-50 p-3">
                    <p className="text-xs text-slate-500">NTB / Supp</p>
                    <p className="text-lg font-semibold">{selectedImport.totals.ntb.toLocaleString()} / {selectedImport.totals.supplementary.toLocaleString()}</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-left">
                      <tr>
                        <th className="p-2">Agent</th>
                        <th className="p-2 text-right">Transmitted</th>
                        <th className="p-2 text-right">Approvals</th>
                        <th className="p-2 text-right">Booked</th>
                        <th className="p-2 text-right">Volume</th>
                        <th className="p-2 text-right">NTB</th>
                        <th className="p-2 text-right">Supplementary</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedImport.details ?? []).map((detail, index) => (
                        <tr key={detail.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                          <td className="p-2">
                            <p className="font-medium">{detail.agent}</p>
                            <p className="text-xs text-slate-500">
                              {detail.seatNumber ? `Seat ${detail.seatNumber}` : 'No seat'}
                              {detail.seatCategory ? ` - ${detail.seatCategory}` : ''}
                            </p>
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
          <p className="text-sm">Scanning file and checking agents...</p>
        </div>
      </div>
    );
  }

  // ─── STEP: CONFIRM ──────────────────────────────────────────────────────────
  if (step === 'confirm') {
    return (
      <div className="space-y-6 p-6">
        <PageTitle title="Review Before Import" subtitle="Confirm the agents and data before saving" />

        {detectedPeriod && (
          <div className="flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            <span>Importing as MTD period: <span className="font-semibold">{detectedPeriod.label}</span></span>
            <span className="text-xs text-blue-600">Report date: {reportDate}</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Summary banner */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-green-700">{matched.length}</p>
            <p className="text-xs text-green-600 mt-1">Existing Agents</p>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-amber-700">{newAgents.length}</p>
            <p className="text-xs text-amber-600 mt-1">New Agents Found</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-blue-700">{matched.length + approvedNew.length}</p>
            <p className="text-xs text-blue-600 mt-1">Will Be Imported</p>
          </div>
        </div>

        {/* New agents confirmation */}
        {newAgents.length > 0 && (
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
                {newAgents.map((agent, i) => (
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
                      onChange={() => toggleAgentApproval(i)}
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
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-green-600" />
              <CardTitle className="text-green-800">Matched Agents ({matched.length})</CardTitle>
            </div>
            <CardDescription>These agents were found in the campaign and will be imported.</CardDescription>
          </CardHeader>
          <CardContent>
            {matched.length === 0 ? (
              <p className="text-sm text-slate-500">No existing agents matched.</p>
            ) : (
              <div className="max-h-64 overflow-y-auto space-y-1">
                {matched.map((agent, i) => (
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
        </Card>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <Button variant="outline" onClick={handleReset} className="gap-2 sm:w-auto">
            <ArrowLeft className="h-4 w-4" />
            Start Over
          </Button>
          <Button
            onClick={handleConfirmImport}
            disabled={matched.length === 0 && approvedNew.length === 0}
            className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
          >
            <CheckCircle className="h-4 w-4" />
            Confirm &amp; Import{approvedNew.length > 0 ? ` (+ Create ${approvedNew.length} New Agent${approvedNew.length > 1 ? 's' : ''})` : ''}
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
          <p className="text-sm">Creating agents and importing records...</p>
        </div>
      </div>
    );
  }

  // ─── STEP: DONE ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 p-6">
      <PageTitle title="Import Complete" subtitle="Production data has been saved" />

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
              <p className="text-xl font-bold text-green-700">{importResult?.success ?? 0}</p>
              <p className="text-xs text-green-600">Records Imported</p>
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

          {importResult?.errors?.length > 0 && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
              <p className="text-sm font-medium text-yellow-900 mb-2">Errors:</p>
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
                    {metricType === 'all_metrics' ? (
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
                    {metricType !== 'acq' && <th className="text-right p-2">Volume</th>}
                  </tr>
                </thead>
                <tbody>
                  {sortedImportDetails.slice(0, 15).map((d: any, i: number) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="p-2">{d.agent}</td>
                      <td className="p-2">{d.date}</td>
                      {metricType === 'all_metrics' ? (
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
                      {metricType !== 'acq' && (
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

          <Button onClick={handleReset} variant="outline" className="w-full gap-2">
            <Upload className="h-4 w-4" />
            Import Another File
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
