"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const fetcher = async (url: string) => { const response = await fetch(url); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load import history."); return data; };
type ImportBatch = { id: string; fileName: string; reportingPeriods: Array<{ year: number; month: number }>; recordsDetected: number; recordsImported: number; recordsUpdated: number; recordsUnchanged: number; recordsSkipped: number; warningCount: number; errorCount: number; status: string; createdAt: string; importedBy: { name: string }; issues: Array<{ id: string; level: string; message: string; sourceSheet: string | null; sourceRow: number | null }> };

export default function ProductionImportHistoryPage() {
  const [page, setPage] = useState(1);
  const { data, error, isLoading } = useSWR<{ imports: ImportBatch[]; pagination: { page: number; totalPages: number; total: number } }>(`/api/production-monitoring/imports?page=${page}`, fetcher);
  return <div className="space-y-6">
    <Link href="/production-monitoring"><Button variant="ghost" className="gap-2 pl-0"><ArrowLeft className="h-4 w-4" />Production Monitoring</Button></Link>
    <div><h1 className="text-2xl font-bold">Production Import History</h1><p className="text-sm text-muted-foreground">Audit workbook imports, partial-import outcomes, warnings, and validation failures.</p></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><FileSpreadsheet className="h-4 w-4" />Imports</CardTitle></CardHeader><CardContent className="p-0">
      {isLoading ? <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-12" />)}</div> : error ? <p className="p-10 text-center text-red-700">{error.message}</p> : !data?.imports.length ? <p className="p-12 text-center text-muted-foreground">No production imports have been recorded.</p> : <div className="overflow-x-auto"><Table><TableHeader><TableRow>{["File", "Periods", "Imported By", "Imported At", "Detected", "New", "Updated", "Unchanged", "Skipped", "Warnings", "Errors", "Status"].map((heading) => <TableHead key={heading}>{heading}</TableHead>)}</TableRow></TableHeader><TableBody>{data.imports.map((batch) => <TableRow key={batch.id}><TableCell className="max-w-56 font-medium"><p className="truncate" title={batch.fileName}>{batch.fileName}</p><p className="text-xs text-muted-foreground">{batch.id}</p></TableCell><TableCell className="whitespace-nowrap">{batch.reportingPeriods.map((period) => `${new Date(Date.UTC(period.year, period.month - 1)).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}`).join(", ")}</TableCell><TableCell>{batch.importedBy.name}</TableCell><TableCell className="whitespace-nowrap">{new Date(batch.createdAt).toLocaleString()}</TableCell><TableCell>{batch.recordsDetected}</TableCell><TableCell>{batch.recordsImported}</TableCell><TableCell>{batch.recordsUpdated}</TableCell><TableCell>{batch.recordsUnchanged}</TableCell><TableCell>{batch.recordsSkipped}</TableCell><TableCell>{batch.warningCount}</TableCell><TableCell>{batch.errorCount}</TableCell><TableCell><span className={`whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${batch.status === "COMPLETED" ? "bg-emerald-100 text-emerald-800" : batch.status.includes("WARNING") ? "bg-amber-100 text-amber-900" : batch.status.includes("ERROR") ? "bg-red-100 text-red-800" : "bg-slate-100 text-slate-700"}`}>{batch.status.replaceAll("_", " ")}</span>{batch.issues[0] && <p className="mt-1 max-w-64 text-xs text-muted-foreground">{batch.issues[0].sourceSheet}{batch.issues[0].sourceRow ? ` row ${batch.issues[0].sourceRow}` : ""}: {batch.issues[0].message}</p>}</TableCell></TableRow>)}</TableBody></Table></div>}
      {data && data.pagination.totalPages > 1 && <div className="flex items-center justify-between border-t p-4 text-sm"><span>Page {data.pagination.page} of {data.pagination.totalPages}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>}
    </CardContent></Card>
  </div>;
}
