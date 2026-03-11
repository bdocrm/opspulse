import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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
    const month = now.getMonth();
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);

    // Get all agents in the campaign
    const agents = await prisma.user.findMany({
      where: {
        role: "AGENT",
        campaignId: campaignId,
      },
    });

    // OPTIMIZATION: Fetch ALL daily sales for the campaign in ONE query instead of N queries
    const allDailySales = await prisma.dailySales.findMany({
      where: {
        campaignId: campaignId,
        date: { gte: startOfMonth, lte: endOfMonth },
      },
    });

    // Group daily sales by agent ID for easy lookup
    const salesByAgent = new Map<string, typeof allDailySales>();
    allDailySales.forEach((sale) => {
      if (!salesByAgent.has(sale.userId)) {
        salesByAgent.set(sale.userId, []);
      }
      salesByAgent.get(sale.userId)!.push(sale);
    });

    const agentPerformances: AgentPerformance[] = [];
    let totalGoal = 0;
    let totalActual: bigint = 0n;
    let coreTotal = 0;
    let coreMet = 0;
    let rookieTotal = 0;
    let rookieMet = 0;

    // Calculate performance for each agent using pre-fetched data
    for (const agent of agents) {
      const dailySales = salesByAgent.get(agent.id) || [];

      // Sum based on campaign KPI metric
      let actual: bigint = 0n;
      dailySales.forEach((sale) => {
        switch (campaign.kpiMetric) {
          case "transmittals":
            actual = actual + (sale.transmittals || 0n);
            break;
          case "activations":
            actual = actual + (sale.activations || 0n);
            break;
          case "approvals":
            actual = actual + (sale.approvals || 0n);
            break;
          case "booked":
            actual = actual + (sale.booked || 0n);
            break;
          default:
            actual = actual + (sale.transmittals || 0n);
        }
      });

      const goal = agent.monthlyTarget || campaign.monthlyGoal;
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
        actual: Number(actual),
        achievement: Math.round(achievement * 10000) / 100, // 2 decimal places
        status,
      });

      totalGoal += goal;
      totalActual = totalActual + actual;

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
      totalGoal > 0 ? Math.round((Number(totalActual) / totalGoal) * 10000) / 100 : 0;
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
        kpiMetric: campaign.kpiMetric,
      },
      overallPerformance: {
        totalGoal: totalGoal,
        totalActual: Number(totalActual),
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
    agents.reduce((acc, a) => acc + a.achievement, 0) / agents.length;
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
