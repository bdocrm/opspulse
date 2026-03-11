import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function verify() {
  const agents = await prisma.user.findMany({
    where: { role: "AGENT" },
    select: { id: true, name: true, seatNumber: true },
    orderBy: { seatNumber: "asc" },
  });

  console.log("All Agents in Database:");
  agents.forEach((a) => console.log(`  Seat ${a.seatNumber}: ${a.name}`));

  console.log("\n\nAgents with Sales Data in March 2026:");
  const salesByAgent = await prisma.dailySales.groupBy({
    by: ["userId"],
    where: {
      date: {
        gte: new Date(2026, 2, 1), // March 1
        lte: new Date(2026, 2, 31), // March 31
      },
    },
  });

  const agentIds = salesByAgent.map((s) => s.userId);
  const agentsWithSales = await prisma.user.findMany({
    where: { id: { in: agentIds } },
    select: { id: true, name: true, seatNumber: true },
    orderBy: { seatNumber: "asc" },
  });

  agentsWithSales.forEach((a) => {
    console.log(`  Seat ${a.seatNumber}: ${a.name}`);
  });

  console.log(`\nTotal agents: ${agents.length}`);
  console.log(`Agents with March sales: ${agentsWithSales.length}`);
}

verify()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
