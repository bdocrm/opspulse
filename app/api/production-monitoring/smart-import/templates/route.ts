import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, importUser, sameOrigin } from "@/lib/smart-import/api";
import { saveTemplate } from "@/lib/smart-import/templates";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const user = await importUser();
    return NextResponse.json(await prisma.importMappingTemplate.findMany({ where: { ownerId: user.id }, select: { id: true, name: true, version: true, createdAt: true }, orderBy: [{ name: "asc" }, { version: "desc" }], take: 250 }));
  } catch (error) { return apiError(error); }
}
export async function POST(request: NextRequest) {
  try {
    sameOrigin(request);
    const user = await importUser();
    const body = await request.json();
    return NextResponse.json(await saveTemplate(body.batchId, body.name, user), { status: 201 });
  } catch (error) { return apiError(error); }
}
