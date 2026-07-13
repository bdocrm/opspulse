const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const columns = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'ProductionDetail'
      AND column_name IN (
        'transmittedVolume', 'approvalsVolume', 'bookedVolume',
        'sourceSheet', 'monthlyActual'
      )
    ORDER BY column_name
  `);
  const normalizedColumns = await prisma.$queryRawUnsafe(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'ProductionMetricRecord'
    ORDER BY ordinal_position
  `);
  const normalizedRecordCount = await prisma.productionMetricRecord.count();
  const campaigns = await prisma.campaign.findMany({
    select: { campaignName: true },
    orderBy: { campaignName: 'asc' },
  });
  const collectors = await prisma.user.findMany({ where: { role: 'COLLECTOR' }, select: { email: true, password: true, campaign: { select: { campaignName: true } } } });
  const bpiPl = await prisma.campaign.findFirst({ where: { campaignName: 'BPI PL' }, select: { id: true } });
  const bpiPlAgents = bpiPl ? await prisma.user.count({ where: { role: 'AGENT', campaignId: bpiPl.id } }) : 0;
  const sampleAgent = await prisma.user.findFirst({ where: { name: { contains: 'TIMBAL', mode: 'insensitive' } }, select: { name: true, campaign: { select: { campaignName: true } } } });
  const testCollectors = [];
  for (const collector of collectors) {
    if (await bcrypt.compare('password123', collector.password)) testCollectors.push(`${collector.email} (${collector.campaign?.campaignName || 'unassigned'})`);
  }
  console.log(JSON.stringify({ columns, normalizedColumns, normalizedRecordCount, campaigns: campaigns.map((row) => row.campaignName), bpiPlAgents, sampleAgent, testCollectors }, null, 2));
}

main().finally(() => prisma.$disconnect());
