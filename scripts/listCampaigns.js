const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const campaigns = await prisma.campaign.findMany({ orderBy: { createdAt: 'desc' } });
  if (!campaigns || campaigns.length === 0) {
    console.log('No campaigns found in the Campaign table.');
    return;
  }
  console.log(JSON.stringify(campaigns, null, 2));
}

main()
  .catch((e) => {
    console.error('Error fetching campaigns:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
