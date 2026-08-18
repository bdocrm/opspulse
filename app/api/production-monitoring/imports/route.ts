import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canAdminProduction, getProductionSessionUser } from "@/lib/production-access";

export async function GET(request: NextRequest) {
  const user = getProductionSessionUser(await getServerSession(authOptions));
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAdminProduction(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page")) || 1);
  const pageSize = 25;
  const [total, imports] = await prisma.$transaction([
    prisma.productionImport.count(),
    prisma.productionImport.findMany({
      include: { importedBy: { select: { id: true, name: true } }, issues: { select: { id: true, level: true, code: true, message: true, sourceSheet: true, sourceRow: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);
  return NextResponse.json({ imports, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } });
}
