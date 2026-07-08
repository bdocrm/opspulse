import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { KpiMetricKey } from "@/utils/kpi";

interface AgentPerformance {
  id: string;
  name: string;
  level: string;
  seatNumber: number | null;
  daysWorked: number;
  transmittals: number;
  activations: number;
  approvals: number;
  booked: number;
  qualityRate: number;
  conversionRate: number;
  goal: number;
  actual: number;
  achievement: number;
  status: "hit" | "near" | "missed";
}

const BUSINESS_TIME_ZONE = "Asia/Manila";
const BUSINESS_TIME_ZONE_OFFSET = "+08:00";

function monthRange(year: number, month: number) {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();

  return {
    start: new Date(`${year}-${mm}-01T00:00:00.000${BUSINESS_TIME_ZONE_OFFSET}`),
    end: new Date(`${year}-${mm}-${String(lastDay).padStart(2, "0")}T23:59:59.999${BUSINESS_TIME_ZONE_OFFSET}`),
  };
}

function toBusinessYmd(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);

  const yyyy = parts.find((part) => part.type === "year")?.value ?? "0000";
  const mm = parts.find((part) => part.type === "month")?.value ?? "01";
  const dd = parts.find((part) => part.type === "day")?.value ?? "01";

  return `${yyyy}-${mm}-${dd}`;
}

type MetricTotals = {
  transmittals: number;
  activations: number;
  approvals: number;
  booked: number;
  volume: number;
  transaction: number;
};

type AgentTotals = MetricTotals & { workedDates: Set<string> };

function emptyAgentTotals(): AgentTotals {
  return {
    transmittals: 0,
    activations: 0,
    approvals: 0,
    booked: 0,
    volume: 0,
    transaction: 0,
    workedDates: new Set<string>(),
  };
}

function normalizeName(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function agentSeatKey(name: string | null | undefined, seatNumber: number | null | undefined) {
  return `${normalizeName(name)}|${seatNumber ?? ""}`;
}

function mergeTotals(target: AgentTotals, source: AgentTotals) {
  target.transmittals += source.transmittals;
  target.activations += source.activations;
  target.approvals += source.approvals;
  target.booked += source.booked;
  target.volume += source.volume;
  target.transaction += source.transaction;
  source.workedDates.forEach((date) => target.workedDates.add(date));
}

function normalizeMetric(metric: string | null | undefined): KpiMetricKey {
  const normalized = (metric ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (["activation", "activations", "activated", "act"].includes(normalized)) return "activations";
  if (["approval", "approvals", "approved", "appr"].includes(normalized)) return "approvals";
  if (["book", "booked", "booking", "bookings"].includes(normalized)) return "booked";
  if (["volume", "vol"].includes(normalized)) return "volume";
  if (["transaction", "transactions", "txn", "txns"].includes(normalized)) return "transaction";
  return "transmittals";
}

function metricValue(metric: KpiMetricKey, totals: MetricTotals) {
  if (metric === "activations") return totals.activations;
  if (metric === "approvals") return totals.approvals;
  if (metric === "booked") return totals.booked;
  if (metric === "volume") return totals.volume;
  if (metric === "transaction") return totals.transaction;
  return totals.transmittals;
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? (numerator / denominator) * 100 : 0;
}

function performanceStatus(achievement: number): "hit" | "near" | "missed" {
  if (achievement >= 100) return "hit";
  if (achievement >= 85) return "near";
  return "missed";
}

function resolveEffectiveMetric(
  configuredMetric: KpiMetricKey,
  campaignGoal: number,
  campaignTotals: MetricTotals,
  agents: Array<{ monthlyTarget: number | null }>
): KpiMetricKey {
  const configuredActual = metricValue(configuredMetric, campaignTotals);
  const targetValues = agents.map((agent) => Number(agent.monthlyTarget || 0)).filter((target) => target > 0);
  const averageTarget =
    targetValues.length > 0 ? targetValues.reduce((sum, target) => sum + target, 0) / targetValues.length : 0;
  const looksLikeMoneyGoal = campaignGoal >= 1_000_000 || averageTarget >= 1_000_000;
  const hasMeaningfulVolume = campaignTotals.volume > configuredActual && campaignTotals.volume > 0;

  // Some imported campaigns store peso-volume goals while the legacy KPI field
  // still says "transmittals". In that case, using count actuals against volume
  // goals makes every achievement look like 0%.
  if (configuredMetric !== "volume" && looksLikeMoneyGoal && hasMeaningfulVolume) {
    return "volume";
  }

  return configuredMetric;
}

// Determine agent level based on seat number
function getAgentLevel(seatNumber: number | null): string {
  if (!seatNumber) return "ROOKIE";
  if (seatNumber <= 4) return "CORE";
  return "ROOKIE";
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as any).role;

    // Only CEO and OM can access
    if (userRole !== "CEO" && userRole !== "OM") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const campaignId = searchParams.get("campaignId");
    const now = new Date();
    const year = parseInt(searchParams.get("year") ?? now.getFullYear().toString());
    const month = parseInt(searchParams.get("month") ?? String(now.getMonth() + 1));

    if (!campaignId) {
      return NextResponse.json(
        { error: "campaignId is required" },
        { status: 400 }
      );
    }

    // Get campaign details
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    const { start: startOfMonth, end: endOfMonth } = monthRange(year, month);

    const monthlyConfig = await prisma.campaignGoal.findFirst({
      where: { campaignId, month, year },
      select: { monthlyGoal: true, kpiMetric: true },
    });
    const campaignGoal = Number(monthlyConfig?.monthlyGoal ?? campaign.monthlyGoal ?? 0);
    const configuredCampaignMetric = normalizeMetric(monthlyConfig?.kpiMetric ?? campaign.kpiMetric);

    // Get all agents in the campaign
    const campaignAgents = await prisma.user.findMany({
      where: {
        role: "AGENT",
        campaignId: campaignId,
      },
      select: {
        id: true,
        name: true,
        seatNumber: true,
        monthlyTarget: true,
      },
      orderBy: [{ seatNumber: "asc" }, { name: "asc" }],
    });

    const productionDetails = await prisma.productionDetail.findMany({
      where: {
        campaignId: campaignId,
        productionEntry: {
          OR: [
            { date: { gte: startOfMonth, lte: endOfMonth } },
            {
              periodStart: { lte: endOfMonth },
              periodEnd: { gte: startOfMonth },
            },
          ],
        },
      },
      select: {
        agentId: true,
        transmittals: true,
        activations: true,
        approvals: true,
        booked: true,
        volume: true,
        transaction: true,
        agent: { select: { id: true, name: true, seatNumber: true, monthlyTarget: true } },
        productionEntry: { select: { date: true, periodEnd: true } },
      },
    });

    const agentsById = new Map(campaignAgents.map((agent) => [agent.id, agent]));
    productionDetails.forEach((detail) => {
      if (detail.agent && !agentsById.has(detail.agent.id)) {
        agentsById.set(detail.agent.id, detail.agent);
      }
    });
    const agents = Array.from(agentsById.values());

    // Group production by agent ID for easy lookup.
    const totalsByAgentId = new Map<string, AgentTotals>();
    const totalsByNameSeat = new Map<string, AgentTotals>();
    const totalsByName = new Map<string, AgentTotals>();
    const campaignTotals: MetricTotals = {
      transmittals: 0,
      activations: 0,
      approvals: 0,
      booked: 0,
      volume: 0,
      transaction: 0,
    };

    productionDetails.forEach((detail) => {
      const transmittals = Number(detail.transmittals || 0);
      const activations = Number(detail.activations || 0);
      const approvals = Number(detail.approvals || 0);
      const booked = Number(detail.booked || 0);
      const volume = Number(detail.volume || 0);
      const transaction = Number(detail.transaction || 0);

      campaignTotals.transmittals += transmittals;
      campaignTotals.activations += activations;
      campaignTotals.approvals += approvals;
      campaignTotals.booked += booked;
      campaignTotals.volume += volume;
      campaignTotals.transaction += transaction;

      const rowTotals = emptyAgentTotals();
      rowTotals.transmittals = transmittals;
      rowTotals.activations = activations;
      rowTotals.approvals = approvals;
      rowTotals.booked = booked;
      rowTotals.volume = volume;
      rowTotals.transaction = transaction;
      rowTotals.workedDates.add(toBusinessYmd(detail.productionEntry.periodEnd ?? detail.productionEntry.date));

      const idTotals = totalsByAgentId.get(detail.agentId) ?? emptyAgentTotals();
      mergeTotals(idTotals, rowTotals);
      totalsByAgentId.set(detail.agentId, idTotals);

      const nameSeat = agentSeatKey(detail.agent?.name, detail.agent?.seatNumber);
      if (nameSeat !== "|") {
        const keyedTotals = totalsByNameSeat.get(nameSeat) ?? emptyAgentTotals();
        mergeTotals(keyedTotals, rowTotals);
        totalsByNameSeat.set(nameSeat, keyedTotals);
      }

      const name = normalizeName(detail.agent?.name);
      if (name) {
        const namedTotals = totalsByName.get(name) ?? emptyAgentTotals();
        mergeTotals(namedTotals, rowTotals);
        totalsByName.set(name, namedTotals);
      }
    });

    const agentPerformances: AgentPerformance[] = [];
    const campaignMetric = resolveEffectiveMetric(
      configuredCampaignMetric,
      campaignGoal,
      campaignTotals,
      agents
    );
    const totalActual = metricValue(campaignMetric, campaignTotals);
    let coreTotal = 0;
    let coreMet = 0;
    let rookieTotal = 0;
    let rookieMet = 0;
    const explicitTargetTotal = agents.reduce(
      (sum, agent) => sum + (Number(agent.monthlyTarget) > 0 ? Number(agent.monthlyTarget) : 0),
      0
    );
    const totalGoal = campaignGoal > 0 ? campaignGoal : explicitTargetTotal;
    const agentsWithoutTargets = agents.filter((agent) => !agent.monthlyTarget || Number(agent.monthlyTarget) <= 0);
    const fallbackGoal =
      agentsWithoutTargets.length > 0
        ? Math.max(campaignGoal - explicitTargetTotal, 0) / agentsWithoutTargets.length
        : 0;

    // Calculate performance for each agent using pre-fetched data
    for (const agent of agents) {
      const agentTotals =
        totalsByAgentId.get(agent.id) ??
        totalsByNameSeat.get(agentSeatKey(agent.name, agent.seatNumber)) ??
        totalsByName.get(normalizeName(agent.name)) ??
        emptyAgentTotals();
      const actual = metricValue(campaignMetric, agentTotals);
      const goal = Number(agent.monthlyTarget) > 0 ? Number(agent.monthlyTarget) : fallbackGoal;
      const achievement = goal > 0 ? (Number(actual) / goal) * 100 : 0;
      const status = performanceStatus(achievement);

      agentPerformances.push({
        id: agent.id,
        name: agent.name,
        level: getAgentLevel(agent.seatNumber),
        seatNumber: agent.seatNumber,
        daysWorked: agentTotals.workedDates.size,
        transmittals: agentTotals.transmittals,
        activations: agentTotals.activations,
        approvals: agentTotals.approvals,
        booked: agentTotals.booked,
        qualityRate: percent(agentTotals.approvals, agentTotals.transmittals),
        conversionRate: percent(agentTotals.booked, agentTotals.transmittals),
        goal,
        actual,
        achievement: Math.round(achievement * 100) / 100,
        status,
      });

      // Group by level
      const agentLevel = getAgentLevel(agent.seatNumber);
      if (agentLevel === "CORE") {
        coreTotal++;
        if (achievement >= 100) coreMet++;
      } else {
        rookieTotal++;
        if (achievement >= 100) rookieMet++;
      }
    }

    // Calculate overall achievement
    const overallAchievement =
      totalGoal > 0 ? Math.round((totalActual / totalGoal) * 10000) / 100 : 0;
    const campaignHitTarget = overallAchievement >= 100;
    const campaignTargetStatus = performanceStatus(overallAchievement);

    // Get top 5 performers
    const topPerformers = agentPerformances
      .sort((a, b) => b.achievement - a.achievement)
      .slice(0, 5);

    // Get agents needing attention (below near-target threshold)
    const needingAttention = agentPerformances
      .filter((a) => a.achievement < 85)
      .sort((a, b) => a.achievement - b.achievement);

    // Get critically low performers (below 70%)
    const critical = needingAttention.filter((a) => a.achievement < 70);

    // Generate coaching recommendations
    const recommendations = generateCoachingRecommendations(
      agentPerformances,
      topPerformers,
      critical,
      campaign
    );

    return NextResponse.json({
      campaign: {
        id: campaign.id,
        name: campaign.campaignName,
        kpiMetric: campaignMetric,
      },
      overallPerformance: {
        totalGoal: totalGoal,
        totalActual,
        achievementRate: overallAchievement,
        targetHit: campaignHitTarget,
        targetStatus: campaignTargetStatus,
      },
      topPerformers,
      needingAttention,
      critical,
      breakdown: {
        core: {
          total: coreTotal,
          met: coreMet,
          missed: coreTotal - coreMet,
          averageAchievement: calculateAverageByLevel(
            agentPerformances,
            "CORE"
          ),
        },
        rookie: {
          total: rookieTotal,
          met: rookieMet,
          missed: rookieTotal - rookieMet,
          averageAchievement: calculateAverageByLevel(
            agentPerformances,
            "ROOKIE"
          ),
        },
      },
      allAgents: agentPerformances.sort((a, b) => b.achievement - a.achievement),
      recommendations,
    });
  } catch (error) {
    console.error("Campaign performance API error:", error);
    return NextResponse.json(
      { 
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error)
      }, 
      { status: 500 }
    );
  }
}

function calculateAverageByLevel(
  agents: AgentPerformance[],
  level: string
): number {
  const levelAgents = agents.filter((a) => a.level === level);
  if (levelAgents.length === 0) return 0;
  const sum = levelAgents.reduce((acc, a) => acc + a.achievement, 0);
  return Math.round((sum / levelAgents.length) * 100) / 100;
}

function generateCoachingRecommendations(
  agents: AgentPerformance[],
  topPerformers: AgentPerformance[],
  critical: AgentPerformance[],
  campaign: any
): string[] {
  const recommendations: string[] = [];

  // Recommendation 1: Identify patterns in top performers
  if (topPerformers.length > 0) {
    const topLevels = topPerformers.map((p) => p.level);
    const coreCount = topLevels.filter((l) => l === "CORE").length;
    const rookieCount = topLevels.filter((l) => l === "ROOKIE").length;

    if (coreCount > rookieCount) {
      recommendations.push(
        `📊 CORE agents are dominating top performance. Consider pairing high-performing CORE agents with underperforming ROOKIE agents for mentoring (Buddy System).`
      );
    } else if (rookieCount > coreCount) {
      recommendations.push(
        `🚀 ROOKIE agents showing exceptional performance! Analyze their techniques and share best practices with the team.`
      );
    }
  }

  // Recommendation 2: Critical performers
  if (critical.length > 0) {
    const criticalRate = (critical.length / agents.length) * 100;
    if (criticalRate > 25) {
      recommendations.push(
        `⚠️ ${critical.length} agents critically below 70% target (${criticalRate.toFixed(0)}% of team). Schedule 1-on-1 coaching sessions this week to diagnose barriers.`
      );
    } else {
      recommendations.push(
        `🎯 Focus on ${critical.length} underperformers: ${critical.map((c) => c.name).join(", ")}. Offer immediate support and resources.`
      );
    }
  }

  // Recommendation 3: Overall team performance
  const avgAchievement =
    agents.length > 0
      ? agents.reduce((acc, a) => acc + a.achievement, 0) / agents.length
      : 0;
  if (avgAchievement < 80) {
    recommendations.push(
      `📈 Team average is ${avgAchievement.toFixed(0)}%. Review campaign messaging, provide updated product training, or adjust targets if market conditions changed.`
    );
  }

  // Recommendation 4: Near-miss analysis
  const nearMiss = agents.filter(
    (a) => a.achievement >= 70 && a.achievement < 100
  );
  if (nearMiss.length > 2) {
    recommendations.push(
      `💪 ${nearMiss.length} agents are close to target (70-100%). A small productivity boost could push them over. Consider mini-incentives or extended hours this sprint.`
    );
  }

  // Recommendation 5: Goal validation
  if (agents.length > 0) {
    const extremeVariance = agents.some(
      (a) => a.achievement > 2 && agents.some((b) => b.achievement < 0.5)
    );
    if (extremeVariance) {
      recommendations.push(
        `🔍 Significant variance in performance. Audit if goals are realistic and fairly distributed. Some agents may need adjusted targets based on market/territory.`
      );
    }
  }

  return recommendations.slice(0, 5); // Return top 5 recommendations
}
