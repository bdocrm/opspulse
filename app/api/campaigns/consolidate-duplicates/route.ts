import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * One-time maintenance: reconcile existing duplicate campaigns.
 *
 * When two (or more) Campaign rows share the same name, agents and production
 * data get split across their ids. The Collector Dashboard is bound to one id
 * while Goals Management may list another — making the two views diverge.
 *
 * GET  → dry-run report of duplicate-named campaign groups (no writes).
 * POST → merge each duplicate group into its earliest-created campaign,
 *        repointing all related rows, then deleting the now-empty duplicates.
 *
 * CEO only. The POST is idempotent: after running, GET returns no duplicates.
 */

// Group campaigns by a normalized (trimmed, lower-cased) name.
async function findDuplicateGroups() {
  const campaigns = await prisma.campaign.findMany({
    select: { id: true, campaignName: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const byName = new Map<string, { id: string; campaignName: string; createdAt: Date }[]>();
  for (const c of campaigns) {
    const key = c.campaignName.trim().toLowerCase();
    const list = byName.get(key) ?? [];
    list.push(c);
    byName.set(key, list);
  }

  return Array.from(byName.values()).filter((group) => group.length > 1);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'CEO') {
    return NextResponse.json({ error: 'Unauthorized: CEO access required' }, { status: 403 });
  }

  const groups = await findDuplicateGroups();
  const report = await Promise.all(
    groups.map(async (group) => {
      const [primary, ...duplicates] = group; // earliest created = primary
      const members = await Promise.all(
        group.map(async (c) => ({
          id: c.id,
          createdAt: c.createdAt,
          isPrimary: c.id === primary.id,
          agentCount: await prisma.user.count({ where: { campaignId: c.id, role: 'AGENT' } }),
        }))
      );
      return {
        name: primary.campaignName,
        keepCampaignId: primary.id,
        mergeFromCampaignIds: duplicates.map((d) => d.id),
        members,
      };
    })
  );

  return NextResponse.json({ duplicateGroups: report, count: report.length });
}

export async function POST(_req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user || (session.user as any).role !== 'CEO') {
    return NextResponse.json({ error: 'Unauthorized: CEO access required' }, { status: 403 });
  }

  const groups = await findDuplicateGroups();
  const merged: { name: string; keptCampaignId: string; removedCampaignIds: string[] }[] = [];

  for (const group of groups) {
    const [primary, ...duplicates] = group;
    const dupIds = duplicates.map((d) => d.id);
    if (dupIds.length === 0) continue;

    await prisma.$transaction(async (tx) => {
      // Repoint every campaign-scoped relation to the primary campaign.
      await tx.user.updateMany({ where: { campaignId: { in: dupIds } }, data: { campaignId: primary.id } });
      await tx.dailySales.updateMany({ where: { campaignId: { in: dupIds } }, data: { campaignId: primary.id } });
      await tx.productionEntry.updateMany({ where: { campaignId: { in: dupIds } }, data: { campaignId: primary.id } });
      await tx.productionDetail.updateMany({ where: { campaignId: { in: dupIds } }, data: { campaignId: primary.id } });
      await tx.attendance.updateMany({ where: { campaignId: { in: dupIds } }, data: { campaignId: primary.id } });

      // CampaignMetric has a unique [campaignId, metricName]; drop duplicate
      // metric rows that would collide with the primary's before repointing.
      const primaryMetrics = await tx.campaignMetric.findMany({
        where: { campaignId: primary.id },
        select: { metricName: true },
      });
      const taken = new Set(primaryMetrics.map((m) => m.metricName));
      const dupMetrics = await tx.campaignMetric.findMany({
        where: { campaignId: { in: dupIds } },
        select: { id: true, metricName: true },
      });
      const collidingIds = dupMetrics.filter((m) => taken.has(m.metricName)).map((m) => m.id);
      if (collidingIds.length > 0) {
        await tx.campaignMetric.deleteMany({ where: { id: { in: collidingIds } } });
      }
      await tx.campaignMetric.updateMany({ where: { campaignId: { in: dupIds } }, data: { campaignId: primary.id } });

      // The duplicate campaign rows are now empty — remove them.
      await tx.campaign.deleteMany({ where: { id: { in: dupIds } } });
    });

    merged.push({ name: primary.campaignName, keptCampaignId: primary.id, removedCampaignIds: dupIds });
  }

  return NextResponse.json({ merged, groupsMerged: merged.length });
}
