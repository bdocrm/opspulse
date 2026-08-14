import { Prisma } from "@prisma/client";
import type { KpiSessionUser } from "@/lib/kpi-access";
import { getSessionCampaignIds } from "@/lib/kpi-access";
import { getKpiStatus } from "@/lib/kpi-performance";

export function kpiRecordScope(user: KpiSessionUser): Prisma.CollectorKpiRecordWhereInput {
  if (user.role === "AGENT") return { employeeId: user.id || "__missing__" };
  if (user.role === "CEO" || user.role === "SMT") return {};
  return { campaignId: { in: getSessionCampaignIds(user) } };
}

export function statusWhere(status: string | null): Prisma.CollectorKpiRecordWhereInput {
  switch (status) {
    case "EXCEEDS_TARGET": return { overallScore: { gte: 1.05 } };
    case "MEETS_TARGET": return { overallScore: { gte: 1, lt: 1.05 } };
    case "NEAR_TARGET": return { overallScore: { gte: 0.9, lt: 1 } };
    case "BELOW_TARGET": return { overallScore: { lt: 0.9 } };
    case "NO_DATA": return { overallScore: null };
    default: return {};
  }
}

export function serializeKpiRecord<T extends {
  achievementQa: number | null;
  achievementAht: number | null;
  achievementAdherence: number | null;
  achievementCm: number | null;
  achievementCd: number | null;
  overallScore: number | null;
}>(record: T) {
  return {
    ...record,
    status: getKpiStatus(record.overallScore),
    metricStatuses: {
      qa: getKpiStatus(record.achievementQa),
      aht: getKpiStatus(record.achievementAht),
      adherence: getKpiStatus(record.achievementAdherence),
      cm: getKpiStatus(record.achievementCm),
      cd: getKpiStatus(record.achievementCd),
    },
  };
}
