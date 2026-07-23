const { PrismaClient } = require("@prisma/client");
const fs = require("node:fs");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();
const baseUrl = process.env.TEST_BASE_URL || "http://localhost:3000";

function mergeCookies(current, response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);
  const jar = new Map(
    current
      .split("; ")
      .filter(Boolean)
      .map((item) => item.split(/=(.*)/s).slice(0, 2))
  );
  for (const value of values) {
    const [name, cookieValue] = value
      .split(";", 1)[0]
      .split(/=(.*)/s)
      .slice(0, 2);
    jar.set(name, cookieValue);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function login(email, password = "password123") {
  let cookie = "";
  const csrfResponse = await fetch(`${baseUrl}/api/auth/csrf`);
  cookie = mergeCookies(cookie, csrfResponse);
  const { csrfToken } = await csrfResponse.json();
  const response = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
    method: "POST",
    headers: {
      cookie,
      "content-type": "application/x-www-form-urlencoded",
    },
    redirect: "manual",
    body: new URLSearchParams({
      csrfToken,
      email,
      password,
      callbackUrl: `${baseUrl}/collector`,
      json: "true",
    }),
  });
  return mergeCookies(cookie, response);
}

async function main() {
  const availableCampaigns = await prisma.campaign.findMany({
    select: { id: true, campaignName: true },
    orderBy: { campaignName: "asc" },
  });
  const testPassword = `campaign-${crypto.randomUUID()}`;
  const testCollector = await prisma.user.create({
    data: {
      name: "Campaign Achievement Integration Test",
      email: `campaign-achievement-${crypto.randomUUID()}@test.local`,
      password: await bcrypt.hash(testPassword, 10),
      role: "COLLECTOR",
      campaignId: availableCampaigns[0].id,
      campaignAssignments: {
        create: availableCampaigns.map((campaign) => ({
          campaignId: campaign.id,
        })),
      },
    },
  });
  global.testCollectorId = testCollector.id;
  const masterCookie = await login(testCollector.email, testPassword);
  const workbookBytes = fs.readFileSync("OM Dashboard 2025.xlsx");
  const previewForm = new FormData();
  previewForm.append(
    "file",
    new Blob([workbookBytes], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    "OM Dashboard 2025.xlsx"
  );
  previewForm.append("mode", "preview");
  previewForm.append("importMode", "all");
  previewForm.append("metricType", "all");
  previewForm.append("reportPeriodType", "monthly");
  previewForm.append("duplicateMode", "skip");
  previewForm.append("reportDate", "2025-01-01");
  previewForm.append("reportMonth", "1");
  previewForm.append("reportYear", "2025");
  previewForm.append(
    "campaignIds",
    JSON.stringify(availableCampaigns.map((campaign) => campaign.id))
  );
  let response = await fetch(`${baseUrl}/api/collectors/bulk-import`, {
    method: "POST",
    headers: { cookie: masterCookie },
    body: previewForm,
  });
  const workbookPreview = await response.json();
  if (!response.ok) throw new Error(`Workbook preview failed: ${JSON.stringify(workbookPreview)}`);
  const previewCampaigns = new Set(
    (workbookPreview.previewRecords || []).map((record) => record.campaignName)
  );
  if (
    workbookPreview.workbookSummary?.worksheetsAccepted < 12 ||
    previewCampaigns.size < 5 ||
    !(workbookPreview.worksheetPreviews || []).some(
      (sheet) => sheet.campaignMapping === "record"
    )
  ) {
    throw new Error(
      `Multi-campaign workbook was not mapped per row: ${JSON.stringify({
        summary: workbookPreview.workbookSummary,
        campaigns: [...previewCampaigns],
      })}`
    );
  }

  const periodRows = await prisma.$queryRaw`
    SELECT "year", "month", COUNT(DISTINCT "campaignId")::int AS campaigns
    FROM "DashboardImportRecord"
    WHERE "month" IS NOT NULL AND ("actual" IS NOT NULL OR "target" IS NOT NULL)
    GROUP BY "year", "month"
    ORDER BY campaigns DESC, "year" DESC, "month" DESC
    LIMIT 1
  `;
  if (!periodRows.length) throw new Error("No persisted dashboard import period was found");
  const period = periodRows[0];
  const lastDay = new Date(Date.UTC(period.year, period.month, 0))
    .getUTCDate()
    .toString()
    .padStart(2, "0");
  const month = String(period.month).padStart(2, "0");
  const query = `dateFrom=${period.year}-${month}-01&dateTo=${period.year}-${month}-${lastDay}&attendanceDate=${period.year}-${month}-${lastDay}`;

  response = await fetch(`${baseUrl}/api/collectors/dashboard?${query}`, {
    headers: { cookie: masterCookie },
  });
  const all = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(all));

  const ids = all.campaigns.map((campaign) => campaign.id);
  if (new Set(ids).size !== ids.length) throw new Error("Duplicate campaign rows returned");
  if (all.campaigns.length < Number(period.campaigns)) {
    throw new Error(`Expected at least ${period.campaigns} campaigns, received ${all.campaigns.length}`);
  }
  if (
    !all.campaigns.every(
      (campaign) =>
        "campaignProduction" in campaign &&
        "achievementPercent" in campaign &&
        "recordCount" in campaign &&
        "dataStatus" in campaign
    )
  ) {
    throw new Error("One or more campaign achievement records are incomplete");
  }
  if (all.summary.campaignCount !== all.campaigns.length) {
    throw new Error("Summary campaign count does not match campaign records");
  }

  const requested = all.campaigns.find((campaign) => campaign.recordCount > 0);
  if (!requested) throw new Error("No imported campaign was returned for the selected period");
  response = await fetch(
    `${baseUrl}/api/collectors/dashboard?${query}&campaignId=${requested.id}`,
    { headers: { cookie: masterCookie } }
  );
  const specific = await response.json();
  if (!response.ok || specific.campaigns.length !== 1 || specific.campaigns[0].id !== requested.id) {
    throw new Error(`Specific campaign filter failed: ${JSON.stringify(specific)}`);
  }

  const limitedCookie = await login("collector.3@opsview.com");
  const unauthorizedCampaign = all.campaigns.find(
    (campaign) => campaign.campaignName !== "BPI PL"
  );
  response = await fetch(
    `${baseUrl}/api/collectors/dashboard?${query}&campaignId=${unauthorizedCampaign.id}`,
    { headers: { cookie: limitedCookie } }
  );
  if (response.status !== 403) {
    throw new Error(`Unauthorized campaign filter returned ${response.status}`);
  }

  console.log(
    JSON.stringify(
      {
        selectedPeriod: { year: period.year, month: period.month },
        workbookPreview: {
          worksheetsAccepted: workbookPreview.workbookSummary.worksheetsAccepted,
          validRecords: workbookPreview.workbookSummary.totalValidRecords,
          campaignsDetected: [...previewCampaigns].sort(),
        },
        importedCampaignsInDatabase: period.campaigns,
        apiCampaigns: all.campaigns.length,
        statuses: Object.fromEntries(
          all.campaigns.map((campaign) => [
            campaign.campaignName,
            {
              production: campaign.campaignProduction,
              goal: campaign.goal,
              achievementPercent: campaign.achievementPercent,
              recordCount: campaign.recordCount,
              dataStatus: campaign.dataStatus,
            },
          ])
        ),
        summary: all.summary,
        specificCampaignFilter: specific.campaigns[0].campaignName,
        unauthorizedCampaignStatus: response.status,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (global.testCollectorId) {
      await prisma.userCampaign.deleteMany({
        where: { userId: global.testCollectorId },
      });
      await prisma.user.deleteMany({
        where: { id: global.testCollectorId },
      });
    }
    await prisma.$disconnect();
  });
