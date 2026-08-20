import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { Prisma } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { saveCampaignMapping } from "@/lib/campaign-mapping";
import { createApprovedDepartmentMapping } from "@/lib/department-resolution";
import {
  canCreateCampaignMappings,
  canManageCampaignMappings,
  canViewCampaignMappings,
  getProductionSessionUser,
  hasProductionCampaignAccess,
  productionCampaignIds,
} from "@/lib/production-access";

type MappingInput = {
  sourceAccount?: string;
  sourceCampaign?: string;
  opsviewCampaignId?: string;
  createCampaignName?: string;
  sourceFile?: string;
  notes?: string | null;
};

async function sessionUser() {
  return getProductionSessionUser(await getServerSession(authOptions));
}

export async function GET(request: NextRequest) {
  const user = await sessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewCampaignMappings(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const includeDisabled = request.nextUrl.searchParams.get("status") === "ALL";
  const search = request.nextUrl.searchParams.get("search")?.trim().slice(0, 100) || "";
  const scopedCampaignIds = productionCampaignIds(user);
  const mappings = await prisma.campaignMapping.findMany({
    where: {
      ...(!includeDisabled ? { status: "ACTIVE" } : {}),
      ...(!canManageCampaignMappings(user)
        ? { opsviewCampaignId: { in: scopedCampaignIds } }
        : {}),
      ...(search ? { OR: [
        { sourceAccount: { contains: search, mode: "insensitive" } },
        { sourceCampaign: { contains: search, mode: "insensitive" } },
        { opsviewCampaign: { campaignName: { contains: search, mode: "insensitive" } } },
      ] } : {}),
    },
    include: {
      opsviewCampaign: { select: { id: true, campaignName: true, isActive: true } },
      updatedBy: { select: { id: true, name: true } },
      audits: {
        take: 10,
        orderBy: { createdAt: "desc" },
        include: { changedBy: { select: { id: true, name: true } } },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { sourceAccount: "asc" }, { sourceCampaign: "asc" }],
    take: 1000,
  });
  return NextResponse.json({ mappings, canManage: canManageCampaignMappings(user), canCreate: canCreateCampaignMappings(user) });
}

export async function POST(request: NextRequest) {
  const user = await sessionUser();
  if (!user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canCreateCampaignMappings(user)) return NextResponse.json({ error: "You do not have permission to modify campaign mappings." }, { status: 403 });
  const body = await request.json().catch(() => null) as { mappings?: MappingInput[] } | MappingInput | null;
  const inputs = Array.isArray((body as { mappings?: MappingInput[] } | null)?.mappings)
    ? (body as { mappings: MappingInput[] }).mappings.slice(0, 1000)
    : body ? [body as MappingInput] : [];
  if (!inputs.length) return NextResponse.json({ error: "Choose at least one campaign mapping." }, { status: 400 });
  if (inputs.some((item) => !item.sourceAccount?.trim())) return NextResponse.json({ error: "Account value is required for every mapping." }, { status: 400 });
  if (inputs.some((item) => !item.sourceCampaign?.trim())) return NextResponse.json({ error: "Source campaign value is required for every mapping." }, { status: 400 });
  if (inputs.some((item) => !item.opsviewCampaignId && !item.createCampaignName?.trim())) return NextResponse.json({ error: "Choose an OpsView campaign or an approved new department for every mapping." }, { status: 400 });
  if (!canManageCampaignMappings(user) && inputs.some((item) => item.createCampaignName?.trim())) {
    return NextResponse.json({ error: "You do not have permission to create new departments." }, { status: 403 });
  }
  if (!canManageCampaignMappings(user) && inputs.some((item) => item.opsviewCampaignId && !hasProductionCampaignAccess(user, item.opsviewCampaignId))) {
    return NextResponse.json({ error: "One or more selected campaigns are outside your assigned access." }, { status: 403 });
  }
  try {
    const saved = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const input of inputs) {
        if (!input.opsviewCampaignId && input.createCampaignName) {
          results.push(await createApprovedDepartmentMapping(tx, {
            sourceAccount: input.sourceAccount as string,
            sourceCampaign: input.sourceCampaign as string,
            canonicalDepartment: input.createCampaignName,
            sourceFile: input.sourceFile,
            notes: input.notes,
          }, user.id as string));
          continue;
        }
        const saved = await saveCampaignMapping(tx, {
          sourceAccount: input.sourceAccount as string,
          sourceCampaign: input.sourceCampaign as string,
          opsviewCampaignId: input.opsviewCampaignId as string,
          mappingType: canManageCampaignMappings(user) ? "ADMIN_DEFINED" : "MANUAL",
          notes: input.notes,
        }, user.id as string);
        results.push({ ...saved, createdDepartment: false });
      }
      return results;
    });
    return NextResponse.json({
      mappings: saved.map(({ mapping, action, createdDepartment }) => ({ ...mapping, action, createdDepartment })),
      saved: saved.length,
      createdDepartments: saved.filter((item) => item.createdDepartment).length,
      message: saved.length === 1 ? "Campaign mapping saved successfully." : `${saved.length} campaign mappings saved.`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "CAMPAIGN_NOT_FOUND") return NextResponse.json({ error: "The selected OpsView campaign no longer exists." }, { status: 400 });
    if (error instanceof Error && error.message === "CAMPAIGN_INACTIVE") return NextResponse.json({ error: "The selected OpsView campaign is inactive." }, { status: 400 });
    if (error instanceof Error && error.message === "DEPARTMENT_CREATION_REQUIRES_REVIEW") return NextResponse.json({ error: "This source campaign is not approved for automatic department creation and requires review." }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return NextResponse.json({ error: "A mapping for this account and source campaign already exists." }, { status: 409 });
    console.error("Campaign mapping save error", error);
    return NextResponse.json({ error: "Unable to save campaign mapping." }, { status: 500 });
  }
}
