'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageTitle } from '@/components/layout/page-title';
import { Upload, AlertCircle, CheckCircle, Download, UserPlus, Users, ArrowLeft } from 'lucide-react';

type Step = 'configure' | 'previewing' | 'confirm' | 'importing' | 'done';

interface MatchedAgent {
  name: string;
  count: number;
  volume: number;
  agentId: string;
  agentName: string;
}

interface NewAgent {
  name: string;
  count: number;
  volume: number;
  approved: boolean;
}

const METRIC_LABELS: Record<string, string> = {
  transmittals: 'Transmittals',
  approvals: 'Approvals',
  booked: 'Booked',
  all_metrics: 'All (Transmittals, Approvals, Booked)',
};

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

  // Flow state
  const [step, setStep] = useState<Step>('configure');
  const [matched, setMatched] = useState<MatchedAgent[]>([]);
  const [newAgents, setNewAgents] = useState<NewAgent[]>([]);
  const [importResult, setImportResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

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
    setStep('configure');
  };

  const downloadTemplate = () => {
    let csv: string;
    if (metricType === 'all_metrics') {
      // Format with separate columns for each metric type
      csv = [
        `,BPI,LEVEL,TRANSMITTALS,APPROVALS,BOOKED,VOLUME`,
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
    a.href = url; a.download = 'bpi-pa-import-template.csv'; a.click();
    URL.revokeObjectURL(url);
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
            <p><span className="font-medium text-slate-800">All Metrics (.xlsx) or CSV:</span> Row 1 = BPI/LEVEL/TRANSMITTALS/APPROVALS/BOOKED/VOLUME · Row 2 = FULL NAME · Row 3+ = No. | Full Name | Level | Transmittals | Approvals | Booked | Volume</p>
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
                Metric Type {metricType === 'all_metrics' ? '(TRANSMITTALS/APPROVALS/BOOKED columns)' : '(COUNT column)'}
              </label>
              <select
                value={metricType}
                onChange={e => setMetricType(e.target.value)}
                className="w-full border border-slate-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="transmittals">Transmittals</option>
                <option value="approvals">Approvals</option>
                <option value="booked">Booked</option>
                <option value="all_metrics">All (Transmittals, Approvals, Booked)</option>
              </select>
              <p className="text-xs text-slate-500">
                {metricType === 'all_metrics'
                  ? 'Transmittals, Approvals, and Booked columns will be stored separately'
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
              <p className="text-xs text-slate-500">Date this data is as-of (used in daily trends)</p>
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
            <Button onClick={handlePreview} disabled={!file || !campaignId} className="w-full gap-2">
              <Upload className="h-4 w-4" />
              Preview Import
            </Button>
          </CardContent>
        </Card>
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
                      {metricType === 'all_metrics' ? (
                        <>
                          <p className="text-sm font-semibold text-slate-700">
                            T: {(agent.transmittals ?? 0).toLocaleString()} | A: {(agent.approvals ?? 0).toLocaleString()} | B: {(agent.booked ?? 0).toLocaleString()}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm font-semibold text-slate-700">{agent.count.toLocaleString()} {METRIC_LABELS[metricType]}</p>
                      )}
                      {agent.volume > 0 && (
                        <p className="text-xs text-slate-500">₱{agent.volume.toLocaleString()}</p>
                      )}
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
                      {metricType === 'all_metrics' ? (
                        <>
                          <p className="text-sm font-semibold text-slate-700">
                            T: {(agent.transmittals ?? 0).toLocaleString()} | A: {(agent.approvals ?? 0).toLocaleString()} | B: {(agent.booked ?? 0).toLocaleString()}
                          </p>
                        </>
                      ) : (
                        <p className="text-sm font-semibold text-slate-700">{agent.count.toLocaleString()} {METRIC_LABELS[metricType]}</p>
                      )}
                      {agent.volume > 0 && (
                        <p className="text-xs text-slate-500">₱{agent.volume.toLocaleString()}</p>
                      )}
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
                    <th className="text-left p-2">Date</th>
                    {metricType === 'all_metrics' ? (
                      <>
                        <th className="text-right p-2">Transmittals</th>
                        <th className="text-right p-2">Approvals</th>
                        <th className="text-right p-2">Booked</th>
                      </>
                    ) : (
                      <th className="text-right p-2">{METRIC_LABELS[metricType]}</th>
                    )}
                    <th className="text-right p-2">Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {importResult.details.slice(0, 15).map((d: any, i: number) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      <td className="p-2">{d.agent}</td>
                      <td className="p-2">{d.date}</td>
                      {metricType === 'all_metrics' ? (
                        <>
                          <td className="text-right p-2">{(d.transmittals ?? 0).toLocaleString()}</td>
                          <td className="text-right p-2">{(d.approvals ?? 0).toLocaleString()}</td>
                          <td className="text-right p-2">{(d.booked ?? 0).toLocaleString()}</td>
                        </>
                      ) : (
                        <td className="text-right p-2">
                          {(d.transmittals ?? d.approvals ?? d.booked ?? 0).toLocaleString()}
                        </td>
                      )}
                      <td className="text-right p-2">
                        {d.volume > 0 ? `₱${Number(d.volume).toLocaleString()}` : '—'}
                      </td>
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
