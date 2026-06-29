import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getAssignedCampaignIds } from '@/lib/user-campaigns';

// GET - Fetch attendance for a specific date and campaign
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date');
    const campaignId = searchParams.get('campaignId') || user.campaignId;

    if (!date) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    // Parse date to start/end of day
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    let attendance: any[] = [];
    try {
      attendance = await prisma.attendance.findMany({
        where: {
          campaignId,
          date: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      });
    } catch (error: any) {
      // Table might not exist yet, return empty array
      console.warn("Attendance table not available, returning empty list");
      attendance = [];
    }

    // Convert to a map of agentId -> status
    const attendanceMap: Record<string, { status: string; remarks: string | null }> = {};
    attendance.forEach((record: any) => {
      attendanceMap[record.agentId] = {
        status: record.status,
        remarks: record.remarks,
      };
    });

    return NextResponse.json({
      date,
      campaignId,
      attendance: attendanceMap,
      count: attendance.length,
    });
  } catch (error: any) {
    console.error('Error fetching attendance:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST - Save/Update attendance for multiple agents
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = session.user as any;
    const body = await request.json();
    const { date } = body;

    // Accept two shapes for backward compatibility:
    //  - bulk map:    { date, attendance: { [agentId]: { status, remarks? } } }
    //  - single agent:{ date, agentId, status, remarks? }   (dashboard toggle)
    let attendance: Record<string, { status: string; remarks?: string }>;
    if (body.attendance && typeof body.attendance === 'object') {
      attendance = body.attendance;
    } else if (body.agentId && body.status) {
      attendance = { [body.agentId]: { status: body.status, remarks: body.remarks } };
    } else {
      return NextResponse.json({ error: 'Date and attendance data are required' }, { status: 400 });
    }

    if (!date) {
      return NextResponse.json({ error: 'Date is required' }, { status: 400 });
    }

    // Resolve each agent's own campaign so a multi-campaign collector records
    // attendance against the correct campaign (not just their primary). Only
    // agents in one of the collector's assigned campaigns are accepted.
    const agentIds = Object.keys(attendance);
    const agentRecords = await prisma.user.findMany({
      where: { id: { in: agentIds }, role: 'AGENT' },
      select: { id: true, campaignId: true },
    });
    const agentCampaign = new Map(agentRecords.map((a) => [a.id, a.campaignId]));

    const assignedIds = await getAssignedCampaignIds(user.id);
    const allowed = new Set(assignedIds);

    // Parse date
    const attendanceDate = new Date(date);
    attendanceDate.setHours(12, 0, 0, 0); // Set to noon to avoid timezone issues

    // Upsert attendance records
    const results = [];
    for (const [agentId, data] of Object.entries(attendance)) {
      const { status, remarks } = data as { status: string; remarks?: string };
      const campaignId = agentCampaign.get(agentId) ?? user.campaignId;

      // Skip agents outside the collector's assigned campaigns (CEO unrestricted).
      if (user.role !== 'CEO' && (!campaignId || !allowed.has(campaignId))) {
        continue;
      }
      if (!campaignId) continue;

      const record = await prisma.attendance.upsert({
        where: {
          agentId_date: {
            agentId,
            date: attendanceDate,
          },
        },
        create: {
          agentId,
          campaignId,
          date: attendanceDate,
          status: status as any,
          remarks: remarks || null,
          createdBy: user.id,
        },
        update: {
          status: status as any,
          remarks: remarks || null,
        },
      });
      results.push(record);
    }

    return NextResponse.json({
      success: true,
      message: `Attendance saved for ${results.length} agents`,
      count: results.length,
    });
  } catch (error: any) {
    console.error('Error saving attendance:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
