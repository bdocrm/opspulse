import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🔄 Seeding database...");

  // Clean existing data - preserve production data and attendance (user-entered data)
  await prisma.dailySales.deleteMany();
  await prisma.agentTarget.deleteMany().catch(() => {});
  // DO NOT DELETE: productionDetail, productionEntry, attendance, user, campaign (preserve user-entered data)

  // Create users only if they don't exist (idempotent)
  const passwordHash = await bcrypt.hash("password123", 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@opsview.com" },
    update: {},
    create: {
      name: "Admin User",
      email: "admin@opsview.com",
      password: passwordHash,
      role: Role.CEO,
    },
  });

  const manager = await prisma.user.upsert({
    where: { email: "manager@opsview.com" },
    update: {},
    create: {
      name: "Sarah Manager",
      email: "manager@opsview.com",
      password: passwordHash,
      role: Role.OM,
    },
  });

  // Create campaigns (idempotent - only if they don't exist)
  const campaignData = [
    { name: "BPI PA OUTBOUND", goal: 500, metric: "transmittals" },
    { name: "BPI PA INBOUND", goal: 450, metric: "transmittals" },
    { name: "BPI PL", goal: 400, metric: "activations" },
    { name: "BPI BL", goal: 350, metric: "activations" },
    { name: "MB ACQ", goal: 480, metric: "transmittals" },
    { name: "MB PL", goal: 420, metric: "activations" },
    { name: "MB PA", goal: 380, metric: "booked" },
    { name: "BDO SGM", goal: 500, metric: "transmittals" },
    { name: "BDO CIE", goal: 450, metric: "activations" },
    { name: "BDO SUPPLE", goal: 350, metric: "booked" },
    { name: "BDO VC", goal: 400, metric: "transmittals" },
    { name: "BDO NTH CARD", goal: 380, metric: "activations" },
    { name: "AXA", goal: 420, metric: "booked" },
    { name: "AXA CLP", goal: 390, metric: "transmittals" },
    { name: "CBC", goal: 450, metric: "activations" },
    { name: "CBC HPL", goal: 380, metric: "booked" },
    { name: "MEDICARD", goal: 360, metric: "transmittals" },
  ];

  const campaigns = await Promise.all(
    campaignData.map(async (c) => {
      const existing = await prisma.campaign.findFirst({
        where: { campaignName: c.name }
      });
      if (existing) return existing;
      return prisma.campaign.create({
        data: {
          campaignName: c.name,
          goalType: "sales",
          monthlyGoal: c.goal,
          kpiMetric: c.metric,
        },
      });
    })
  );

  // Agent configuration: Each agent with their assigned campaigns
  const agentConfigs = [
    { name: "John Smith", seat: 1, campaignIndices: [0, 1, 2] }, // BPI campaigns
    { name: "Jane Doe", seat: 2, campaignIndices: [3, 4] }, // BPI + MB
    { name: "Mike Johnson", seat: 3, campaignIndices: [5, 6, 7] }, // MB + BDO
    { name: "Emily Davis", seat: 4, campaignIndices: [8, 9, 10] }, // BDO
    { name: "Chris Wilson", seat: 5, campaignIndices: [11, 12, 13] }, // BDO + AXA
    { name: "Anna Brown", seat: 6, campaignIndices: [14, 15, 16] }, // CBC + MEDICARD
    { name: "David Lee", seat: 7, campaignIndices: [0, 5, 11] }, // Mixed
    { name: "Lisa Chen", seat: 8, campaignIndices: [1, 6, 12] }, // Mixed
  ];

  // Create agents and assign to campaigns (idempotent)
  const agents = await Promise.all(
    agentConfigs.map((config) => {
      const email = `${config.name.toLowerCase().replace(" ", ".")}@opsview.com`;
      return prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          name: config.name,
          email,
          password: passwordHash,
          role: Role.AGENT,
          seatNumber: config.seat,
          campaignId: campaigns[config.campaignIndices[0]].id,
        },
      });
    })
  );

  // Create collectors dynamically - one collector per campaign (idempotent)
  const collectors = await Promise.all(
    campaigns.map((campaign, index) => {
      // Keep the established collector login numbers stable; collector.5 was
      // dedicated to the retired campaign.
      const collectorNumber = index >= 4 ? index + 2 : index + 1;
      const email = `collector.${collectorNumber}@opsview.com`;
      return prisma.user.upsert({
        where: { email },
        update: {},
        create: {
          name: `Collector - ${campaign.campaignName}`,
          email,
          password: passwordHash,
          role: Role.COLLECTOR,
          campaignId: campaign.id,
        },
      });
    })
  );

  // Create Timothy Germedia - Collector with all campaigns (idempotent)
  const timothy = await prisma.user.upsert({
    where: { email: "allianzsynergia.tgermedia@gmail.com" },
    update: {},
    create: {
      name: "Timothy Germedia",
      email: "allianzsynergia.tgermedia@gmail.com",
      password: passwordHash,
      role: Role.COLLECTOR,
      campaignId: campaigns[0].id,
    },
  });

  // Assign Timothy to all campaigns (idempotent - avoid duplicates)
  await Promise.all(
    campaigns.map((campaign) =>
      prisma.userCampaign.upsert({
        where: {
          userId_campaignId: {
            userId: timothy.id,
            campaignId: campaign.id,
          },
        },
        update: {},
        create: {
          userId: timothy.id,
          campaignId: campaign.id,
        },
      })
    )
  );

  // Generate daily sales data for current month - ONLY for assigned campaigns
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  const daysToGenerate = Math.min(today, 28);

  const salesData: any[] = [];

  for (let day = 1; day <= daysToGenerate; day++) {
    const date = new Date(year, month, day);
    // Skip weekends
    if (date.getDay() === 0 || date.getDay() === 6) continue;

    // Create sales only for agent's assigned campaigns
    agents.forEach((agent, agentIndex) => {
      const assignedCampaigns = agentConfigs[agentIndex].campaignIndices;
      assignedCampaigns.forEach((campaignIdx) => {
        const campaign = campaigns[campaignIdx];
        salesData.push({
          userId: agent.id,
          campaignId: campaign.id,
          date,
          transmittals: Math.floor(Math.random() * 8) + 1,
          activations: Math.floor(Math.random() * 6) + 1,
          approvals: Math.floor(Math.random() * 5),
          booked: Math.floor(Math.random() * 4),
          qualityRate: Math.round((70 + Math.random() * 30) * 100) / 100,
          conversionRate: Math.round((30 + Math.random() * 50) * 100) / 100,
        });
      });
    });
  }

  await prisma.dailySales.createMany({ data: salesData });

  console.log(`✅ Seeded:`);
  console.log(`   - ${3 + agents.length + collectors.length} users (1 admin, 1 manager, ${agents.length} agents, ${collectors.length} collectors, 1 multi-campaign collector)`);
  console.log(`   - ${campaigns.length} campaigns`);
  console.log(`   - ${salesData.length} daily sales records`);
  console.log("");
  console.log("📧 Login credentials:");
  console.log("   Admin:     admin@opsview.com / password123");
  console.log("   Manager:   manager@opsview.com / password123");
  console.log("   Agent:     john.smith@opsview.com / password123");
  console.log("   Collector: allianzsynergia.tgermedia@gmail.com / password123 (all 17 campaigns)");
  console.log("");
  console.log("📊 Agent-Campaign Assignments:");
  agentConfigs.forEach((config, idx) => {
    const assignedCampaignNames = config.campaignIndices
      .map((i) => campaigns[i].campaignName)
      .join(", ");
    console.log(`   ${config.name}: ${assignedCampaignNames}`);
  });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
