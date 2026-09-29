import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, importUser, sameOrigin } from "@/lib/smart-import/api";
import { ENGINE, ImportError, stageFile } from "@/lib/smart-import/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const user = await importUser();
    if (Number(request.headers.get("content-length") ?? 0) > 11 * 1024 * 1024) throw new ImportError("File upload exceeds the 10 MB limit.", 413);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ImportError("Choose an Excel or CSV file.");
    try { return NextResponse.json(await stageFile(file, user), { status: 201 }); }
    catch (error) {
      if (error instanceof ImportError) throw error;
      if (error instanceof Error && /(?:file|workbook|supported|column|truncated|coverage|MIME|extension|inspection)/i.test(error.message)) throw new ImportError(error.message, 422);
      throw error;
    }
  } catch (error) { return apiError(error); }
}
export async function GET(request: NextRequest) {
  try {
    const user = await importUser();
    const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
    const where = { engine: ENGINE, ...(user.role === "CEO" ? {} : { importedById: user.id }) };
    const [total, batches] = await Promise.all([
      prisma.productionImport.count({ where }),
      prisma.productionImport.findMany({ where, select: { id: true, fileName: true, fileType: true, reportingPeriods: true, status: true, createdAt: true, completedAt: true, recordsDetected: true, recordsImported: true, recordsUpdated: true, recordsUnchanged: true, pendingCount: true, warningCount: true, conflictCount: true, invalidCount: true, lastError: true, importedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 25, take: 25 }),
    ]);
    return NextResponse.json({ batches, total, page, totalPages: Math.max(1, Math.ceil(total / 25)) });
  } catch (error) { return apiError(error); }
}
