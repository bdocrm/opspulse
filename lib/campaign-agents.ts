import { prisma } from '@/lib/prisma';

/**
 * Shared campaign-agent assignment source.
 *
 * Both the Collector Dashboard leaderboard and the Admin/CEO Goals Management
 * "Agent Targets" list read through these helpers so the two views can never
 * diverge. An agent is "assigned to a campaign" iff it is an active User with
 * role AGENT whose `campaignId` equals the campaign's id. Filtering is always
 * by campaign **id**, never by campaign name (names are not unique).
 */

export interface CampaignAgent {
  id: string;
  name: string;
  email: string;
  seatNumber: number | null;
  monthlyTarget: number | null;
}

const AGENT_SELECT = {
  id: true,
  name: true,
  email: true,
  seatNumber: true,
  monthlyTarget: true,
} as const;

// Deterministic, shared ordering so both dashboards list agents identically.
const AGENT_ORDER_BY = [
  { seatNumber: 'asc' as const },
  { name: 'asc' as const },
];

/** All agents officially assigned to the given campaign id. */
export async function getCampaignAgents(campaignId: string): Promise<CampaignAgent[]> {
  return prisma.user.findMany({
    where: { campaignId, role: 'AGENT' },
    select: AGENT_SELECT,
    orderBy: AGENT_ORDER_BY,
  });
}

/**
 * True iff `agentId` is officially assigned to `campaignId`.
 * Used to validate target saves so an admin cannot set a target for an agent
 * that does not belong to the selected campaign.
 */
export async function isAgentInCampaign(agentId: string, campaignId: string): Promise<boolean> {
  const agent = await prisma.user.findFirst({
    where: { id: agentId, campaignId, role: 'AGENT' },
    select: { id: true },
  });
  return Boolean(agent);
}
