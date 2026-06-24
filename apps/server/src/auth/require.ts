import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@cadence/db';
import type { Role } from '@cadence/db';
import { clearSession, getSessionUserId } from './session';

export interface AuthUser {
  id: string;
  role: Role;
  githubLogin: string;
  teamId: string | null;
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
    select: { id: true, role: true, githubLogin: true, teamId: true },
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

/** Resolve a manager (admin OR team lead) or send 401/403. */
export async function requireManager(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthUser | null> {
  const user = await requireUser(req, reply);
  if (!user) return null;
  if (user.role !== 'admin' && user.role !== 'lead') {
    reply.code(403).send({ error: 'forbidden' });
    return null;
  }
  return user;
}

// ── Team-scoped visibility ───────────────────────────────────────────────────
// OWNER (admin) sees all teams; LEAD sees only their own team; MEMBER (dev) self.
export type Scope =
  | { kind: 'all' }
  | { kind: 'team'; teamId: string }
  | { kind: 'self'; userId: string };

export function resolveScope(actor: AuthUser): Scope {
  if (actor.role === 'admin') return { kind: 'all' };
  if (actor.role === 'lead' && actor.teamId) return { kind: 'team', teamId: actor.teamId };
  return { kind: 'self', userId: actor.id };
}

/** Prisma `where` fragment (on a User) implementing a scope. `{}` = all. */
export function teamWhereForScope(scope: Scope): Record<string, unknown> {
  if (scope.kind === 'all') return {};
  if (scope.kind === 'team') return { teamId: scope.teamId };
  return { id: scope.userId };
}

/**
 * Owner: view anyone. Lead: view users in their own team. Member: only self.
 * Sends 403 and returns false when not allowed. Async because a lead must check
 * the target's team.
 */
export async function assertCanViewUser(
  actor: AuthUser,
  targetUserId: string,
  reply: FastifyReply,
): Promise<boolean> {
  if (actor.role === 'admin' || actor.id === targetUserId) return true;
  if (actor.role === 'lead' && actor.teamId) {
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { teamId: true },
    });
    if (target?.teamId === actor.teamId) return true;
  }
  reply.code(403).send({ error: 'forbidden' });
  return false;
}

/**
 * `where` fragment (on a teamId column — User or Task) for a manager's
 * team-scoped lists. Lead → own team; admin → all, or a specific team when
 * `teamKey` is given (?team= filter). Returns {} for "all".
 */
export async function managerTeamWhere(
  actor: AuthUser,
  teamKey?: string,
): Promise<Record<string, unknown>> {
  if (actor.role === 'lead') return { teamId: actor.teamId ?? '__no_team__' };
  if (teamKey) {
    const team = await prisma.team.findFirst({ where: { key: teamKey, deletedAt: null }, select: { id: true } });
    return { teamId: team?.id ?? '__no_such_team__' };
  }
  return {};
}

/** @deprecated sync owner/self check — prefer assertCanViewUser for team scoping. */
export function canViewUser(actor: AuthUser, targetUserId: string, reply: FastifyReply): boolean {
  if (actor.role === 'admin' || actor.id === targetUserId) return true;
  reply.code(403).send({ error: 'forbidden' });
  return false;
}
