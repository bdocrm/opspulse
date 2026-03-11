'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageTitle } from '@/components/layout/page-title';
import { Upload, AlertCircle, CheckCircle, Download } from 'lucide-react';

export default function BulkImportPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<any>(null);

  // Check authorization
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      const isCSV = selectedFile.name.endsWith('.csv');
      const isExcel = selectedFile.name.endsWith('.xlsx');
      
      if (!isCSV && !isExcel) {
        alert('Please select a CSV or Excel file (.csv or .xlsx)');
        return;
      }
      setFile(selectedFile);
      setResult(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      alert('Please select a file');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/api/collectors/bulk-import', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        setResult({ error: data.error || 'Upload failed' });
      } else {
        setResult(data);
        setFile(null);
      }
    } catch (err) {
      setResult({ error: String(err) });
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    const template = `AgentEmail,Date,Transmittals,Activations,Approvals,Booked
john.smith@opspulse.com,2026-03-11,50,10,8,5
jane.doe@opspulse.com,2026-03-11,45,12,9,6
john.smith@opspulse.com,2026-03-12,55,11,9,6
jane.doe@opspulse.com,2026-03-12,48,13,10,7`;

    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk-import-template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (status === 'loading') {
    return <div className="p-6">Loading...</div>;
  }

  return (
    <div className="space-y-6 p-6">
      <PageTitle
        title="Bulk Data Import"
        subtitle="Upload multiple production entries via CSV"
      />

      {/* Template Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upload Format</CardTitle>
          <CardDescription>
            Supports both CSV and Excel (BPI.xlsx) formats
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div>
              <p className="font-medium text-sm mb-2">CSV Format (Legacy):</p>
              <p className="text-sm text-slate-600">Required columns: AgentEmail, Date, Transmittals, Activations, Approvals, Booked</p>
            </div>
            <div>
              <p className="font-medium text-sm mb-2">Excel Format (BPI.xlsx):</p>
              <p className="text-sm text-slate-600">Column A: Agent name | Monthly sections with Goal and Actual values</p>
            </div>
            <Button onClick={downloadTemplate} variant="outline" className="gap-2">
              <Download className="h-4 w-4" />
              Download CSV Template
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Upload Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upload File</CardTitle>
          <CardDescription>
            Upload CSV or Excel file with production data
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:border-blue-500 transition">
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={handleFileChange}
              className="hidden"
              id="file-input"
            />
            <label htmlFor="file-input" className="cursor-pointer block">
              <Upload className="h-8 w-8 mx-auto text-slate-400 mb-2" />
              <p className="text-sm font-medium text-slate-700">
                {file ? file.name : 'Click to select or drag & drop CSV or Excel file'}
              </p>
              <p className="text-xs text-slate-500 mt-1">Supported: .csv, .xlsx (Maximum 10MB)</p>
            </label>
          </div>

          <Button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="w-full gap-2"
          >
            <Upload className="h-4 w-4" />
            {uploading ? 'Uploading...' : 'Upload & Import'}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <Card className={result.error ? 'border-red-200' : 'border-green-200'}>
          <CardHeader>
            <div className="flex items-center gap-2">
              {result.error ? (
                <>
                  <AlertCircle className="h-5 w-5 text-red-600" />
                  <CardTitle className="text-red-600">Import Failed</CardTitle>
                </>
              ) : (
                <>
                  <CheckCircle className="h-5 w-5 text-green-600" />
                  <CardTitle className="text-green-600">Import Successful</CardTitle>
                </>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.error && <p className="text-red-600 font-medium">{result.error}</p>}

            {result.message && <p className="text-slate-700">{result.message}</p>}

            {result.success > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <p className="text-sm font-medium text-green-900">
                  ✓ Successfully imported {result.success} records
                </p>
              </div>
            )}

            {result.errors && result.errors.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                <p className="text-sm font-medium text-yellow-900 mb-2">
                  Errors ({result.errors.length}):
                </p>
                <ul className="text-sm text-yellow-800 space-y-1 max-h-48 overflow-y-auto">
                  {result.errors.map((err: string, i: number) => (
                    <li key={i}>• {err}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.details && result.details.length > 0 && (
              <div className="overflow-x-auto">
                <table className="text-sm w-full">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="text-left p-2">Agent</th>
                      {result.details[0].month && (
                        <>
                          <th className="text-left p-2">Month</th>
                          <th className="text-left p-2">Level</th>
                          <th className="text-right p-2">Goal</th>
                          <th className="text-right p-2">Actual</th>
                        </>
                      )}
                      {result.details[0].date && (
                        <>
                          <th className="text-left p-2">Date</th>
                          <th className="text-right p-2">Trans</th>
                          <th className="text-right p-2">Act</th>
                          <th className="text-right p-2">App</th>
                          <th className="text-right p-2">Booked</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {result.details.slice(0, 10).map((detail: any, i: number) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="p-2">{detail.agent}</td>
                        {detail.month && (
                          <>
                            <td className="p-2">{detail.month}</td>
                            <td className="p-2">{detail.level}</td>
                            <td className="text-right p-2">{detail.goal?.toLocaleString()}</td>
                            <td className="text-right p-2">{detail.actual?.toLocaleString()}</td>
                          </>
                        )}
                        {detail.date && (
                          <>
                            <td className="p-2">{detail.date}</td>
                            <td className="text-right p-2">{detail.transmittals}</td>
                            <td className="text-right p-2">{detail.activations}</td>
                            <td className="text-right p-2">{detail.approvals}</td>
                            <td className="text-right p-2">{detail.booked}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {result.details.length > 10 && (
                  <p className="text-xs text-slate-500 mt-2">
                    ... and {result.details.length - 10} more records
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Instructions */}
      <Card className="bg-blue-50 border-blue-200">
        <CardHeader>
          <CardTitle className="text-base text-blue-900">Instructions</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-blue-800 space-y-2">
          <p>1. Download the CSV template above</p>
          <p>2. Fill in your production data with agent emails, dates, and metrics</p>
          <p>3. Save as CSV format (.csv)</p>
          <p>4. Upload the file using the form above</p>
          <p>5. Review the import results</p>
        </CardContent>
      </Card>
    </div>
  );
}
