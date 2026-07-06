import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { computeMTD, type DailySalesRow, type KpiMetricKey } from "@/utils/kpi";

interface AgentPerformance {
  id: string;
  name: string;
  level: string;
  goal: number;
  actual: number;
  achievement: number;
  status: "hit" | "near" | "missed";
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

    // Get current month
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const startOfMonth = new Date(year, month - 1, 1);
    startOfMonth.setHours(0, 0, 0, 0);
    const endOfMonth = new Date(year, month, 0);
    endOfMonth.setHours(23, 59, 59, 999);

    const monthlyConfig = await prisma.campaignGoal.findFirst({
      where: { campaignId, month, year },
      select: { monthlyGoal: true, kpiMetric: true },
    });
    const campaignGoal = Number(monthlyConfig?.monthlyGoal ?? campaign.monthlyGoal ?? 0);
    const campaignMetric = (monthlyConfig?.kpiMetric ?? campaign.kpiMetric) as KpiMetricKey;

    // Get all agents in the campaign
    const agents = await prisma.user.findMany({
      where: {
        role: "AGENT",
        campaignId: campaignId,
      },
    });

    const productionDetails = await prisma.productionDetail.findMany({
      where: {
        campaignId: campaignId,
        productionEntry: { date: { gte: startOfMonth, lte: endOfMonth } },
      },
      include: { productionEntry: { select: { date: true } } },
    });

    const rowFromDetail = (detail: (typeof productionDetails)[number]): DailySalesRow => ({
      date: detail.productionEntry.date,
      transmittals: Number(detail.transmittals),
      activations: Number(detail.activations),
      approvals: Number(detail.approvals),
      booked: Number(detail.booked),
      qualityRate: detail.qualityRate,
      conversionRate: detail.conversionRate,
      volume: Number(detail.volume),
      transaction: Number(detail.transaction),
    });

    // Group production by agent ID for easy lookup.
    const rowsByAgent = new Map<string, DailySalesRow[]>();
    const allRows: DailySalesRow[] = [];
    productionDetails.forEach((detail) => {
      const row = rowFromDetail(detail);
      allRows.push(row);
      if (!rowsByAgent.has(detail.agentId)) {
        rowsByAgent.set(detail.agentId, []);
      }
      rowsByAgent.get(detail.agentId)!.push(row);
    });

    const agentPerformances: AgentPerformance[] = [];
    const totalActual = computeMTD(allRows, campaignMetric);
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
      const agentRows = rowsByAgent.get(agent.id) || [];
      const actual = computeMTD(agentRows, campaignMetric);
      const goal = Number(agent.monthlyTarget) > 0 ? Number(agent.monthlyTarget) : fallbackGoal;
      const achievement = goal > 0 ? Number(actual) / goal : 0;
      let status: "hit" | "near" | "missed";

      if (achievement >= 1) status = "hit";
      else if (achievement >= 0.7) status = "near";
      else status = "missed";

      agentPerformances.push({
        id: agent.id,
        name: agent.name,
        level: getAgentLevel(agent.seatNumber),
        goal,
        actual,
        achievement: Math.round(achievement * 10000) / 100, // 2 decimal places
        status,
      });

      // Group by level
      const agentLevel = getAgentLevel(agent.seatNumber);
      if (agentLevel === "CORE") {
        coreTotal++;
        if (achievement >= 1) coreMet++;
      } else {
        rookieTotal++;
        if (achievement >= 1) rookieMet++;
      }
    }

    // Calculate overall achievement
    const overallAchievement =
      totalGoal > 0 ? Math.round((totalActual / totalGoal) * 10000) / 100 : 0;
    const campaignHitTarget = overallAchievement >= 100;

    // Get top 5 performers
    const topPerformers = agentPerformances
      .sort((a, b) => b.achievement - a.achievement)
      .slice(0, 5);

    // Get agents needing attention (below 100%)
    const needingAttention = agentPerformances
      .filter((a) => a.achievement < 100)
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
