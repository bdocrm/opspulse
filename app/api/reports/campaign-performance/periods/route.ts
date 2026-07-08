import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const periods = await prisma.$queryRaw<Array<{ year: number; month: number }>>`
      SELECT DISTINCT
        EXTRACT(YEAR FROM COALESCE(pe."periodEnd", pe."date"))::int AS year,
        EXTRACT(MONTH FROM COALESCE(pe."periodEnd", pe."date"))::int AS month
      FROM "ProductionEntry" pe
      JOIN "ProductionDetail" pd ON pd."productionEntryId" = pe."id"
      ORDER BY year DESC, month DESC
    `;

    return NextResponse.json({ periods });
  } catch (error) {
    console.error("Campaign performance periods error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
