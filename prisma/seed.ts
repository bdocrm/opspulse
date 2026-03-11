import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🔄 Seeding database...");

  // Clean existing data - FORCE DELETE ALL
  await prisma.dailySales.deleteMany();
  await prisma.attendance.deleteMany().catch(() => {}); // Ignore if table doesn't exist
  await prisma.productionDetail.deleteMany().catch(() => {});
  await prisma.productionEntry.deleteMany().catch(() => {});
  await prisma.agentTarget.deleteMany().catch(() => {});
  await prisma.user.deleteMany();
  await prisma.campaign.deleteMany();

  // Create users
  const passwordHash = await bcrypt.hash("password123", 12);

  const admin = await prisma.user.create({
    data: {
      name: "Admin User",
      email: "admin@opspulse.com",
      password: passwordHash,
      role: Role.CEO,
    },
  });

  const manager = await prisma.user.create({
    data: {
      name: "Sarah Manager",
      email: "manager@opspulse.com",
      password: passwordHash,
      role: Role.OM,
    },
  });

  // Create campaigns
  const campaigns = await Promise.all([
    prisma.campaign.create({
      data: {
        campaignName: "BPI PA OUTBOUND",
        goalType: "sales",
        monthlyGoal: 500,
        kpiMetric: "transmittals",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "BPI PA INBOUND",
        goalType: "sales",
        monthlyGoal: 450,
        kpiMetric: "transmittals",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "BPI PL",
        goalType: "sales",
        monthlyGoal: 400,
        kpiMetric: "activations",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "BPI BL",
        goalType: "sales",
        monthlyGoal: 350,
        kpiMetric: "activations",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "BPI FF",
        goalType: "sales",
        monthlyGoal: 300,
        kpiMetric: "booked",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "MB ACQ",
        goalType: "sales",
        monthlyGoal: 480,
        kpiMetric: "transmittals",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "MB PL",
        goalType: "sales",
        monthlyGoal: 420,
        kpiMetric: "activations",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "MB PA",
        goalType: "sales",
        monthlyGoal: 380,
        kpiMetric: "booked",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "BDO SGM",
        goalType: "sales",
        monthlyGoal: 500,
        kpiMetric: "transmittals",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "BDO CIE",
        goalType: "sales",
        monthlyGoal: 450,
        kpiMetric: "activations",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "BDO SUPPLE",
        goalType: "sales",
        monthlyGoal: 350,
        kpiMetric: "booked",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "BDO VC",
        goalType: "sales",
        monthlyGoal: 400,
        kpiMetric: "transmittals",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "BDO NTH CARD",
        goalType: "sales",
        monthlyGoal: 380,
        kpiMetric: "activations",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "AXA",
        goalType: "sales",
        monthlyGoal: 420,
        kpiMetric: "booked",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "AXA CLP",
        goalType: "sales",
        monthlyGoal: 390,
        kpiMetric: "transmittals",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "CBC",
        goalType: "sales",
        monthlyGoal: 450,
        kpiMetric: "activations",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "CBC HPL",
        goalType: "sales",
        monthlyGoal: 380,
        kpiMetric: "booked",
      },
    }),
    prisma.campaign.create({
      data: {
        campaignName: "MEDICARD",
        goalType: "sales",
        monthlyGoal: 360,
        kpiMetric: "transmittals",
      },
    }),
  ]);

  // Agent configuration: Each agent with their assigned campaigns
  const agentConfigs = [
    { name: "John Smith", seat: 1, campaignIndices: [0, 1, 2] }, // BPI campaigns
    { name: "Jane Doe", seat: 2, campaignIndices: [3, 4, 5] }, // BPI + MB
    { name: "Mike Johnson", seat: 3, campaignIndices: [6, 7, 8] }, // MB + BDO
    { name: "Emily Davis", seat: 4, campaignIndices: [9, 10, 11] }, // BDO
    { name: "Chris Wilson", seat: 5, campaignIndices: [12, 13, 14] }, // BDO + AXA
    { name: "Anna Brown", seat: 6, campaignIndices: [15, 16, 17] }, // CBC + MEDICARD
    { name: "David Lee", seat: 7, campaignIndices: [0, 6, 12] }, // Mixed
    { name: "Lisa Chen", seat: 8, campaignIndices: [1, 7, 13] }, // Mixed
  ];

  // Create agents and assign to campaigns
  const agents = await Promise.all(
    agentConfigs.map((config) =>
      prisma.user.create({
        data: {
          name: config.name,
          email: `${config.name.toLowerCase().replace(" ", ".")}@opspulse.com`,
          password: passwordHash,
          role: Role.AGENT,
          seatNumber: config.seat,
          // Assign to first campaign as default
          campaignId: campaigns[config.campaignIndices[0]].id,
        },
      })
    )
  );

  // Create collectors dynamically - one collector per campaign
  const collectors = await Promise.all(
    campaigns.map((campaign, index) =>
      prisma.user.create({
        data: {
          name: `Collector - ${campaign.campaignName}`,
          email: `collector.${index + 1}@opspulse.com`,
          password: passwordHash,
          role: Role.COLLECTOR,
          // Assign to specific campaign
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
  console.log(`   - ${2 + agents.length} users (1 admin, 1 manager, ${agents.length} agents)`);
  console.log(`   - ${campaigns.length} campaigns`);
  console.log(`   - ${salesData.length} daily sales records`);
  console.log("");
  console.log("📧 Login credentials:");
  console.log("   Admin:   admin@opspulse.com / password123");
  console.log("   Manager: manager@opspulse.com / password123");
  console.log("   Agent:   john.smith@opspulse.com / password123");
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
