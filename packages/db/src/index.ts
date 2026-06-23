import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Single shared PrismaClient instance. In dev with hot-reload we stash it on
 * globalThis to avoid exhausting connections across reloads.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
