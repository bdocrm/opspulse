import { Prisma, PrismaClient } from '@prisma/client';

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

/** Schema-qualified identifiers for raw SQL on pooled PostgreSQL connections. */
export function databaseTable(name: string) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error('Invalid database table identifier.');
  const schema = new URL(process.env.DATABASE_URL ?? 'postgresql://localhost/opsview').searchParams.get('schema') ?? 'public';
  return Prisma.raw(`"${schema.replace(/"/g, '""')}"."${name}"`);
}
