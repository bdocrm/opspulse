import path from 'node:path';
import * as XLSX from 'xlsx';
import { loadEnvConfig } from '@next/env';
import { PrismaClient } from '@prisma/client';
import { parseMbGoalAchievementRows } from '../lib/mb-goal-achievement-import';

loadEnvConfig(process.cwd());

const prisma = new PrismaClient();

function normalizeName(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

function unorderedName(value: string) {
  return normalizeName(value).split(' ').filter(Boolean).sort().join(' ');
}

function nameWithoutInitials(value: string) {
  return normalizeName(value).split(' ').filter((token) => token.length > 1).sort().join(' ');
}

async function main() {
  const filePath = path.resolve(
    process.argv[2] || path.join(process.env.USERPROFILE || '', 'Downloads', '2026_Agent_Goal_Achievement (1).xlsx'),
  );
  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const worksheet = workbook.Sheets.PL;
  if (!worksheet) throw new Error('The workbook does not contain the required "PL" worksheet.');

  const rows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, raw: true, defval: null });
  const parsed = parseMbGoalAchievementRows(rows, new Date(2026, 0, 1));
  if (!parsed) throw new Error('The PL worksheet is not a supported MB Goal/Achievement layout.');

  const campaign = await prisma.campaign.findFirst({
    where: { campaignName: { equals: 'MB PL', mode: 'insensitive' } },
    select: { id: true, campaignName: true },
  });
  if (!campaign) throw new Error('MB PL campaign was not found.');

  const agents = await prisma.user.findMany({
    where: { campaignId: campaign.id, role: 'AGENT' },
    select: { id: true, name: true },
  });
  const agentByName = new Map(agents.map((agent) => [normalizeName(agent.name), agent]));
  const agentByUnorderedName = new Map(agents.map((agent) => [unorderedName(agent.name), agent]));
  const agentByNameWithoutInitials = new Map(agents.map((agent) => [nameWithoutInitials(agent.name), agent]));
  const agentIds = agents.map((agent) => agent.id);
  const years = [...new Set(parsed.entries.map((entry) => entry.reportDate.getFullYear()))];
  const [anchors, campaignEntries] = await Promise.all([
    prisma.productionMetricRecord.findMany({
      where: {
        campaignId: campaign.id,
        agentId: { in: agentIds },
        reportPeriodType: 'monthly',
        reportYear: { in: years },
      },
      select: {
        productionEntryId: true,
        agentId: true,
        reportDate: true,
        reportYear: true,
        reportMonth: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.productionEntry.findMany({
      where: {
        campaignId: campaign.id,
        reportPeriodType: 'monthly',
        importFileName: path.basename(filePath),
      },
      select: { id: true, date: true },
      orderBy: { date: 'asc' },
    }),
  ]);
  const anchorByAgentPeriod = new Map<string, (typeof anchors)[number]>();
  for (const anchor of anchors) {
    if (anchor.reportMonth == null) continue;
    const key = `${anchor.agentId}|${anchor.reportYear}-${anchor.reportMonth}`;
    if (!anchorByAgentPeriod.has(key)) anchorByAgentPeriod.set(key, anchor);
  }
  const campaignEntryByPeriod = new Map(
    campaignEntries.map((entry) => [
      `${entry.date.getFullYear()}-${entry.date.getMonth() + 1}`,
      entry,
    ]),
  );

  const records: Array<{
    productionEntryId: string;
    campaignId: string;
    agentId: string;
    reportPeriodType: string;
    reportDate: Date;
    reportMonth: number;
    reportYear: number;
    metricType: string;
    count: bigint | null;
    volume: bigint | null;
    goal: number | null;
    actual: number | null;
    achievement: number | null;
    sourceFile: string;
    sourceSheet: string;
    sourceRow: number;
  }> = [];
  const missingAgents = new Set<string>();
  const missingPeriods = new Set<string>();

  for (const entry of parsed.entries) {
    const agent = agentByName.get(normalizeName(entry.name))
      || agentByUnorderedName.get(unorderedName(entry.name))
      || agentByNameWithoutInitials.get(nameWithoutInitials(entry.name));
    if (!agent) {
      missingAgents.add(entry.name);
      continue;
    }
    const year = entry.reportDate.getFullYear();
    const month = entry.reportDate.getMonth() + 1;
    const anchor = anchorByAgentPeriod.get(`${agent.id}|${year}-${month}`);
    const campaignEntry = campaignEntryByPeriod.get(`${year}-${month}`);
    if (!anchor && !campaignEntry) {
      missingPeriods.add(`${entry.name} ${year}-${String(month).padStart(2, '0')}`);
      continue;
    }
    for (const metric of entry.normalizedMetrics) {
      records.push({
        productionEntryId: anchor?.productionEntryId || campaignEntry!.id,
        campaignId: campaign.id,
        agentId: agent.id,
        reportPeriodType: 'monthly',
        reportDate: anchor?.reportDate || entry.reportDate,
        reportMonth: month,
        reportYear: year,
        metricType: metric.metricType,
        count: metric.count == null ? null : BigInt(Math.round(metric.count)),
        volume: metric.volume == null ? null : BigInt(Math.round(metric.volume)),
        goal: metric.goal ?? null,
        actual: metric.actual ?? null,
        achievement: metric.achievement ?? null,
        sourceFile: path.basename(filePath),
        sourceSheet: 'PL',
        sourceRow: entry.rowIdx,
      });
    }
  }

  const created = await prisma.productionMetricRecord.createMany({
    data: records,
    skipDuplicates: true,
  });

  console.log(JSON.stringify({
    campaign: campaign.campaignName,
    workbook: filePath,
    parsedAgentMonths: parsed.entries.length,
    normalizedRecordsPrepared: records.length,
    normalizedRecordsInserted: created.count,
    missingAgents: [...missingAgents],
    missingPeriods: [...missingPeriods],
    parserWarnings: parsed.warnings,
  }, null, 2));

  if (missingAgents.size || missingPeriods.size || parsed.invalidRows) {
    throw new Error('Backfill was incomplete; review the reported missing rows before continuing.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
