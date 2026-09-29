import { getServerSession } from "next-auth/next";
import { NextResponse } from "next/server";
import { authOptions } from "../auth";
import { prisma } from "../prisma";
import { canImport } from "../permissions";
import { ImportError } from "./service";

export async function importUser() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) throw new ImportError("Unauthorized", 401);
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { id: true, role: true, campaignId: true, campaignAssignments: { select: { campaignId: true } } } });
  if (!user || !canImport(user.role)) throw new ImportError("Import access is required.", 403);
  return { id: user.id, role: user.role, campaignId: user.campaignId, campaignIds: user.campaignAssignments.map(row => row.campaignId) };
}
export function apiError(error: unknown) {
  if (error instanceof ImportError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("Smart import operation failed", error instanceof Error ? error.message : "Unknown error");
  return NextResponse.json({ error: "The import operation failed. Your staged source data is retained; no partial production commit was made." }, { status: 500 });
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) throw new ImportError("Cross-origin import requests are not allowed.", 403);
}
