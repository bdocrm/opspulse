import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function verifySeed() {
  const totalUsers = await prisma.user.count();
  const collectors = await prisma.user.findMany({
    where: { role: "COLLECTOR" },
    select: { email: true, name: true, campaignId: true },
  });
  const campaigns = await prisma.campaign.count();
  const sales = await prisma.dailySales.count();

  console.log("Database Verification:");
  console.log(`Total users: ${totalUsers}`);
  console.log(`Campaigns: ${campaigns}`);
  console.log(`Daily sales records: ${sales}`);
  console.log(`\nCollectors created: ${collectors.length}`);
  
  if (collectors.length > 0) {
    console.log("\nFirst 5 collectors:");
    collectors.slice(0, 5).forEach((c) => {
      console.log(`  - ${c.email}: ${c.name}`);
    });
  }
}

verifySeed()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
