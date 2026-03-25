import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: 
      process.env.NODE_ENV === "development" 
        ? ["query", "error", "warn"]
        : ["error"],
    errorFormat: "pretty",
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// Log connection status
prisma.$connect()
  .then(() => {
    console.log("[Prisma] Successfully connected to database");
  })
  .catch((error) => {
    console.error("[Prisma] Connection failed:", {
      message: error?.message,
      code: error?.code,
      timestamp: new Date().toISOString(),
    });
  });
