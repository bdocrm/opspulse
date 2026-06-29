import { prisma } from '@/lib/prisma';

/**
 * Shared resolver for a user's assigned campaigns (multi-campaign support).
 *
 * A collector/manager may be assigned to many campaigns via the UserCampaign
 * join table. For backward compatibility the legacy `User.campaignId` column is
 * always treated as part of the assigned set (it mirrors the "primary"
 * campaign). These helpers are the single source of truth so every API filters
 * campaigns identically. Filtering is always by campaign **id** (names are not
 * unique).
 */

export interface AssignedCampaign {
  id: string;
  campaignName: string;
}

/**
 * Resolve the de-duplicated set of campaign ids a user is assigned to.
 * Combines the join table with the legacy primary campaignId.
 */
export async function getAssignedCampaignIds(userId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      campaignId: true,
      campaignAssignments: { select: { campaignId: true } },
    },
  });

  if (!user) return [];

  const ids = new Set<string>();
  if (user.campaignId) ids.add(user.campaignId);
  for (const a of user.campaignAssignments) ids.add(a.campaignId);
  return Array.from(ids);
}

/**
 * Resolve the assigned campaigns (id + name) for a user, alphabetically by
 * name. Skips campaigns that no longer exist (deleted campaigns).
 */
export async function getAssignedCampaigns(userId: string): Promise<AssignedCampaign[]> {
  const ids = await getAssignedCampaignIds(userId);
  if (ids.length === 0) return [];

  const campaigns = await prisma.campaign.findMany({
    where: { id: { in: ids } },
    select: { id: true, campaignName: true },
    orderBy: { campaignName: 'asc' },
  });

  return campaigns;
}

/**
 * True iff the user is assigned to the given campaign (primary or via the
 * join table). CEOs are not special-cased here — callers grant CEO global
 * access explicitly where appropriate.
 */
export async function isUserInCampaign(userId: string, campaignId: string): Promise<boolean> {
  const ids = await getAssignedCampaignIds(userId);
  return ids.includes(campaignId);
}

/**
 * Replace a user's full multi-campaign assignment with `campaignIds`, keeping
 * `User.campaignId` in sync as the primary (first) campaign. De-duplicates
 * input, ignores ids that don't reference a real campaign (deleted campaigns),
 * and runs in a transaction so the primary and the join table never diverge.
 *
 * Pass an empty array to clear all assignments. Pass `undefined`/skip calling
 * this entirely to leave assignments untouched.
 */
export async function setUserCampaigns(userId: string, campaignIds: string[]): Promise<void> {
  // De-duplicate while preserving order (first = primary).
  const requested = Array.from(new Set(campaignIds.filter(Boolean)));

  // Drop ids that don't reference an existing campaign so we never write a
  // dangling assignment.
  const valid =
    requested.length > 0
      ? (
          await prisma.campaign.findMany({
            where: { id: { in: requested } },
            select: { id: true },
          })
        ).map((c) => c.id)
      : [];

  // Preserve the requested order for the valid ids (primary = first).
  const ordered = requested.filter((id) => valid.includes(id));
  const primary = ordered[0] ?? null;

  await prisma.$transaction([
    prisma.userCampaign.deleteMany({ where: { userId } }),
    ...(ordered.length > 0
      ? [
          prisma.userCampaign.createMany({
            data: ordered.map((campaignId) => ({ userId, campaignId })),
            skipDuplicates: true,
          }),
        ]
      : []),
    prisma.user.update({ where: { id: userId }, data: { campaignId: primary } }),
  ]);
}
