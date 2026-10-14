import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { apiError, importUser, sameOrigin } from "@/lib/smart-import/api";
import { accessibleBatch, cancelBatch, commitBatch, getPreview, ImportError, reviewBatch } from "@/lib/smart-import/service";
import { csvCell } from "@/lib/smart-import/export";
import type { Candidate } from "@/lib/smart-import/types";
import { applyTemplate } from "@/lib/smart-import/templates";
import { unpackRawRow } from "@/lib/smart-import/raw-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await importUser();
    const batch = await accessibleBatch(params.id, user);
    const format = request.nextUrl.searchParams.get("format");
    if (format === "source") {
      if (!batch.originalFile) throw new ImportError("Source file is unavailable.", 404);
      return new NextResponse(new Uint8Array(batch.originalFile), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(batch.fileName)}`, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
    }
    if (format === "report") {
      const preview = await getPreview(params.id, user);
      return new NextResponse(JSON.stringify({ batch: { id: preview.id, status: preview.status, parentImportId: preview.parentImportId }, events: preview.events, stages: preview.stages, inspection: preview.inspection, reconciliation: preview.reconciliation, records: preview.records, result: preview.result }, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="import-reconciliation.json"', "X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store" } });
    }
    if (format === "rows") {
      const sheet = request.nextUrl.searchParams.get("sheet");
      const page = Math.max(1, Math.floor(Number(request.nextUrl.searchParams.get("page")) || 1));
      const where = { importId: params.id, ...(sheet ? { sourceSheet: sheet } : {}) };
      const [total, rows] = await Promise.all([prisma.productionImportRawRow.count({ where }), prisma.productionImportRawRow.findMany({ where, orderBy: [{ sourceSheet: "asc" }, { sourceRow: "asc" }], skip: (page - 1) * 50, take: 50 })]);
      return NextResponse.json({ total, page, rows: rows.map(row => ({ ...row, rawPayload: unpackRawRow(row.rawPayload) })) });
    }
    if (format === "raw") {
      const sheet = request.nextUrl.searchParams.get("sheet");
      const row = Number(request.nextUrl.searchParams.get("row"));
      if (!sheet || !Number.isInteger(row) || row < 1) throw new ImportError("Choose a valid source row.");
      const raw = await prisma.productionImportRawRow.findUnique({ where: { importId_sourceSheet_sourceRow: { importId: params.id, sourceSheet: sheet, sourceRow: row } } });
      if (!raw) throw new ImportError("Source row not found.", 404);
      return NextResponse.json({ ...raw, rawPayload: unpackRawRow(raw.rawPayload) });
    }
    if (format === "errors") {
      const rows = await prisma.productionImportRawRow.findMany({ where: { importId: params.id, normalizedPayload: { not: Prisma.DbNull } }, select: { sourceSheet: true, sourceRow: true, normalizedPayload: true, rawPayload: true }, orderBy: [{ sourceSheet: "asc" }, { sourceRow: "asc" }] });
      const report: unknown[][] = [["Sheet", "Source row", "Campaign", "KPI", "Status", "Source values", "Issues", "Recommended correction"]];
      for (const row of rows) {
        const candidate = row.normalizedPayload as unknown as Candidate | null;
        if (!candidate?.issues.length) continue;
        report.push([row.sourceSheet, row.sourceRow, candidate.campaignSource, candidate.goalLabel, candidate.status, unpackRawRow(row.rawPayload), candidate.issues.map(issue => `${issue.code}: ${issue.message}`).join(" | "), "Review the reported fields or mapping, correct the source if needed, and revalidate."]);
      }
      return new NextResponse("\uFEFF" + report.map(row => row.map(csvCell).join(",")).join("\r\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="import-issues.csv"', "X-Content-Type-Options": "nosniff" } });
    }
    return NextResponse.json(await getPreview(params.id, user));
  } catch (error) { return apiError(error); }
}
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    sameOrigin(request);
    const user = await importUser();
    const body = await request.json();
    if (body.action === "template") { await applyTemplate(params.id, body.templateId, user); return NextResponse.json(await getPreview(params.id, user)); }
    if (body.action === "review") {
      try { await reviewBatch(params.id, body.options, user); }
      catch (error) { if (!(error instanceof ImportError) && error instanceof Error && /^Invalid|^Choose|^Select|^Rate|^Campaign mapping/.test(error.message)) throw new ImportError(error.message, 422); throw error; }
      return NextResponse.json(await getPreview(params.id, user));
    }
    if (body.action === "commit") return NextResponse.json(await commitBatch(params.id, body.previewHash, body.selectedRows, user));
    if (body.action === "cancel") { await cancelBatch(params.id, user); return NextResponse.json({ status: "CANCELLED" }); }
    throw new ImportError("Choose a valid import action.");
  } catch (error) { return apiError(error); }
}
