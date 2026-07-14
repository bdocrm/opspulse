import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  return new PrismaClient({
    // Query failures are thrown to the calling route and handled there. Keeping
    // Prisma's low-level error logger enabled also prints harmless pool socket
    // closures (common with Neon and Next.js hot reload) as red terminal errors.
    log: process.env.NODE_ENV === 'development' ? ['warn'] : [],
    errorFormat: 'pretty',
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
