"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fetcher = async (url: string) => {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load import details.");
  return data;
};

type ImportDetail = {
  batch: {
    id: string; originalFileName: string; status: string; createdAt: string; completedAt: string | null;
    totalRows: number; successfulRows: number; updatedRows: number; skippedRows: number; failedRows: number; duplicateRows: number; unmatchedRows: number; warningRows: number;
    campaign: { campaignName: string }; uploadedBy: { name: string };
    issues: Array<{ id: string; sourceSheet: string; sourceRow: number | null; employeeName: string | null; kind: string; message: string }>;
    events: Array<{ id: string; employeeName: string; action: string; reason: string | null; sourceSheet: string; sourceRow: number; createdAt: string }>;
    records: Array<{ id: string; employeeId: string; employeeNameSnapshot: string; month: number; year: number; sourceSheet: string; sourceRow: number }>;
  };
};

export default function KpiImportDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useSWR<ImportDetail>(`/api/kpi/imports/${id}`, fetcher);
  if (isLoading) return <div className="space-y-3">{Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-24" />)}</div>;
  if (error || !data) return <Card><CardContent className="p-8 text-center text-red-600">{error?.message || "Import not found."}</CardContent></Card>;
  const batch = data.batch;
  return <div className="space-y-6">
    <Link href="/performance/kpi/imports"><Button variant="ghost" className="gap-2 pl-0"><ArrowLeft className="h-4 w-4" /> Import history</Button></Link>
    <div><h1 className="text-2xl font-bold">{batch.originalFileName}</h1><p className="text-sm text-muted-foreground">{batch.campaign.campaignName} · uploaded by {batch.uploadedBy.name} on {new Date(batch.createdAt).toLocaleString()}</p></div>
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">{[["Rows", batch.totalRows], ["Imported", batch.successfulRows], ["Updated", batch.updatedRows], ["Skipped", batch.skippedRows], ["Duplicates", batch.duplicateRows], ["Unmatched", batch.unmatchedRows], ["Warnings", batch.warningRows], ["Failed", batch.failedRows]].map(([label, count]) => <Card key={label}><CardContent className="pt-5"><p className="text-2xl font-bold">{count}</p><p className="text-xs text-muted-foreground">{label}</p></CardContent></Card>)}</div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4 text-green-600" /> Imported records</CardTitle></CardHeader><CardContent className="p-0">{batch.records.length ? <Table><TableHeader><TableRow><TableHead>Employee</TableHead><TableHead>Period</TableHead><TableHead>Source</TableHead><TableHead>Action</TableHead></TableRow></TableHeader><TableBody>{batch.records.map((record) => <TableRow key={record.id}><TableCell className="font-medium">{record.employeeNameSnapshot}</TableCell><TableCell>{record.month}/{record.year}</TableCell><TableCell>{record.sourceSheet} row {record.sourceRow}</TableCell><TableCell><Link href={`/performance/kpi/collectors/${record.employeeId}?month=${record.month}&year=${record.year}`}><Button size="sm" variant="outline">View KPI</Button></Link></TableCell></TableRow>)}</TableBody></Table> : <p className="p-8 text-center text-muted-foreground">No records were created by this batch.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-amber-600" /> Validation and import issues</CardTitle></CardHeader><CardContent className="p-0">{batch.issues.length ? <Table><TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Employee</TableHead><TableHead>Source</TableHead><TableHead>Message</TableHead></TableRow></TableHeader><TableBody>{batch.issues.map((issue) => <TableRow key={issue.id}><TableCell><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">{issue.kind.replaceAll("_", " ")}</span></TableCell><TableCell>{issue.employeeName || "—"}</TableCell><TableCell>{issue.sourceSheet}{issue.sourceRow ? ` row ${issue.sourceRow}` : ""}</TableCell><TableCell>{issue.message}</TableCell></TableRow>)}</TableBody></Table> : <p className="p-8 text-center text-muted-foreground">No issues were recorded.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle className="text-base">Audit activity</CardTitle></CardHeader><CardContent className="p-0">{batch.events.length ? <Table><TableHeader><TableRow><TableHead>Action</TableHead><TableHead>Employee</TableHead><TableHead>Source</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader><TableBody>{batch.events.map((event) => <TableRow key={event.id}><TableCell className="font-medium">{event.action.replaceAll("_", " ")}</TableCell><TableCell>{event.employeeName}</TableCell><TableCell>{event.sourceSheet} row {event.sourceRow}</TableCell><TableCell>{event.reason || "—"}</TableCell></TableRow>)}</TableBody></Table> : <p className="p-8 text-center text-muted-foreground">No record changes were made.</p>}</CardContent></Card>
  </div>;
}
