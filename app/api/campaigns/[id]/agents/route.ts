import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getCampaignAgents } from '@/lib/campaign-agents';
import { isUserInCampaign } from '@/lib/user-campaigns';

interface Params {
  id: string;
}

// GET: List agents for a specific campaign
export async function GET(
  request: NextRequest,
  { params }: { params: Params }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    const campaignId = params.id;

    // Check if user has access to this campaign. CEO can see all; everyone else
    // may view any campaign in their assigned set (primary or multi-campaign).
    if (user.role !== 'CEO') {
      const allowed = await isUserInCampaign(user.id, campaignId);
      if (!allowed) {
        return NextResponse.json(
          { message: 'Unauthorized to view this campaign' },
          { status: 403 }
        );
      }
    }

    // Shared campaign-agent assignment source (same query the Admin/CEO Goals
    // Management "Agent Targets" list uses) — filtered by campaign id.
    const agents = await getCampaignAgents(campaignId);

    return NextResponse.json(agents);
  } catch (error) {
    console.error('Error fetching campaign agents:', error);
    return NextResponse.json(
      { message: (error as Error).message || 'Failed to fetch agents' },
      { status: 500 }
    );
  }
}
