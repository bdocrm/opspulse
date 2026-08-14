"use client";

import Link from "next/link";
import useSWR from "swr";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fetcher = async (url: string) => {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Unable to load import history.");
  return data;
};

type Batch = {
  id: string; originalFileName: string; periodStart: string | null; periodEnd: string | null;
  successfulRows: number; updatedRows: number; skippedRows: number; failedRows: number; status: string; createdAt: string;
  campaign: { campaignName: string }; uploadedBy: { name: string };
};

export default function KpiImportHistoryPage() {
  const { data, error, isLoading } = useSWR<{ batches: Batch[] }>("/api/kpi/imports", fetcher);
  return <div className="space-y-6">
    <Link href="/performance/kpi"><Button variant="ghost" className="gap-2 pl-0"><ArrowLeft className="h-4 w-4" /> KPI monitoring</Button></Link>
    <div><h1 className="text-2xl font-bold">KPI Import History</h1><p className="text-sm text-muted-foreground">Review workbook imports, outcomes, and validation issues.</p></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="h-4 w-4" /> Imports</CardTitle></CardHeader><CardContent className="p-0">
      {isLoading ? <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div> : error ? <p className="p-8 text-center text-red-600">{error.message}</p> : !data?.batches.length ? <p className="p-12 text-center text-muted-foreground">No KPI imports have been recorded.</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>File name</TableHead><TableHead>Campaign</TableHead><TableHead>Reporting period</TableHead><TableHead>Uploaded by</TableHead><TableHead>Uploaded at</TableHead><TableHead>Imported</TableHead><TableHead>Updated</TableHead><TableHead>Skipped</TableHead><TableHead>Failed</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader><TableBody>{data.batches.map((batch) => <TableRow key={batch.id}><TableCell className="max-w-56 truncate font-medium" title={batch.originalFileName}>{batch.originalFileName}</TableCell><TableCell>{batch.campaign.campaignName}</TableCell><TableCell>{batch.periodStart ? new Date(batch.periodStart).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : "—"}{batch.periodEnd && batch.periodEnd !== batch.periodStart ? ` – ${new Date(batch.periodEnd).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}` : ""}</TableCell><TableCell>{batch.uploadedBy.name}</TableCell><TableCell>{new Date(batch.createdAt).toLocaleString()}</TableCell><TableCell>{batch.successfulRows}</TableCell><TableCell>{batch.updatedRows}</TableCell><TableCell>{batch.skippedRows}</TableCell><TableCell>{batch.failedRows}</TableCell><TableCell><span className={`rounded-full px-2 py-1 text-xs font-medium ${batch.status === "COMPLETED" ? "bg-green-100 text-green-800" : batch.status.includes("WARNING") ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>{batch.status.replaceAll("_", " ")}</span></TableCell><TableCell><Link href={`/performance/kpi/imports/${batch.id}`}><Button variant="outline" size="sm">View details</Button></Link></TableCell></TableRow>)}</TableBody></Table></div>}
    </CardContent></Card>
  </div>;
}
