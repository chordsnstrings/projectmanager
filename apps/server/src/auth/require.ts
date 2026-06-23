import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@cadence/db';
import type { Role } from '@cadence/db';
import { clearSession, getSessionUserId } from './session';

export interface AuthUser {
  id: string;
  role: Role;
  githubLogin: string;
}

/** Resolve the authenticated user or send 401. Returns null when unauthenticated. */
export async function requireUser(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthUser | null> {
  const userId = getSessionUserId(req);
  if (!userId) {
    reply.code(401).send({ error: 'not_authenticated' });
    return null;
  }
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, role: true, githubLogin: true },
  });
  if (!user) {
    clearSession(reply);
    reply.code(401).send({ error: 'not_authenticated' });
    return null;
  }
  return user;
}

/** Resolve an admin or send 401/403. */
export async function requireAdmin(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthUser | null> {
  const user = await requireUser(req, reply);
  if (!user) return null;
  if (user.role !== 'admin') {
    reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  return user;
}

/**
 * Devs may only access their own data; admins may access anyone's. Returns true
 * if `targetUserId` is viewable by `actor`, else sends 403 and returns false.
 */
export function canViewUser(actor: AuthUser, targetUserId: string, reply: FastifyReply): boolean {
  if (actor.role === 'admin' || actor.id === targetUserId) return true;
  reply.code(403).send({ error: 'forbidden' });
  return false;
}
