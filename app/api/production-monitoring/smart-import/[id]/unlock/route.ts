import { NextRequest, NextResponse } from "next/server";
import { apiError, importUser, sameOrigin } from "@/lib/smart-import/api";
import { getPreview, ImportError } from "@/lib/smart-import/service";
import { unlockBatch, UnlockError } from "@/lib/smart-import/unlock";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  let body: { password?: unknown } | undefined;
  try {
    sameOrigin(request);
    const user = await importUser();
    if (process.env.NODE_ENV === "production" && request.nextUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(request.nextUrl.hostname)) throw new ImportError("Use HTTPS to unlock a workbook.", 400);
    if (Number(request.headers.get("content-length") ?? 0) > 4096) throw new ImportError("Unlock request is too large.", 413);
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          size += next.value.byteLength;
          if (size > 4096) { await reader.cancel(); throw new ImportError("Unlock request is too large.", 413); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
    }
    const bytes = Buffer.concat(chunks);
    let text = bytes.toString("utf8");
    bytes.fill(0); chunks.forEach(chunk => chunk.fill(0));
    try { body = JSON.parse(text); } catch { throw new ImportError("Enter a valid unlock request.", 400); }
    text = "";
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ImportError("Enter a valid unlock request.", 400);
    try { return NextResponse.json(await unlockBatch(params.id, body.password, user, request.signal), { headers: { "Cache-Control": "private, no-store" } }); }
    catch (error) {
      if (!(error instanceof UnlockError)) throw error;
      return NextResponse.json({ error: error.code === "RATE_LIMITED" ? "Too many unlock attempts. Wait ten minutes before retrying." : error.message, code: error.code, preview: await getPreview(params.id, user) }, { status: error.status, headers: { "Cache-Control": "private, no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
    }
  } catch (error) { return apiError(error); }
  finally { if (body) body.password = undefined; body = undefined; }
}
