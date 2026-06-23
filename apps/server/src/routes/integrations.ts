// Machine-to-machine integration endpoints, authenticated with a static bearer
// token (CADENCE_API_TOKEN) rather than the browser session cookie.
//
// The activity-check endpoint is built for an external "reminder robot": it polls
// on a schedule and, if nobody has logged activity, emails specific people to
// remind them to sign in. Email is sent on the robot's side (the app platform may
// not be able to send mail), so this endpoint only reports state + the sign-in URL.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '@cadence/db';
import { env } from '../env';
import { localDayRange, localToday, resolveTz } from '../lib/tz';

/** Constant-time bearer check. Returns true when authorized. */
function authorized(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!env.CADENCE_API_TOKEN) {
    reply.code(503).send({ error: 'api_token_not_configured' });
    return false;
  }
  const header = req.headers.authorization ?? '';
  const presented = header.startsWith('Bearer ') ? header.slice(7) : header;
  // Hash both sides to a fixed length so timingSafeEqual never throws on length.
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(env.CADENCE_API_TOKEN).digest();
  if (presented && timingSafeEqual(a, b)) return true;
  reply.code(401).send({ error: 'unauthorized' });
  return false;
}

export async function integrationRoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/integrations/activity?windowMinutes=1440
   *
   * Reports whether anyone started/ended a session (or has one running) within
   * the trailing window, plus a per-user breakdown and the sign-in URL. The robot
   * decides whom to remind.
   */
  app.get<{ Querystring: { windowMinutes?: string } }>(
    '/api/integrations/activity',
    async (req, reply) => {
      if (!authorized(req, reply)) return;

      const now = new Date();
      const windowMinutes = Math.min(
        43_200, // cap 30 days
        Math.max(1, Number(req.query.windowMinutes ?? 1440)), // default last 24h
      );
      const windowStart = new Date(now.getTime() - windowMinutes * 60_000);

      const users = await prisma.user.findMany({
        where: { deletedAt: null },
        select: { id: true, githubLogin: true, name: true, email: true, role: true, timezone: true },
        orderBy: { githubLogin: 'asc' },
      });

      const perUser = [];
      let startedCount = 0;
      let endedCount = 0;
      let openCount = 0;

      for (const u of users) {
        const tz = resolveTz(u.timezone);
        const today = localToday(tz, now);
        const { start: dayStart, end: dayEnd } = localDayRange(today, tz);

        const [startedInWindow, endedInWindow, openSession, lastStarted, lastEnded, todayCount] = await Promise.all([
          prisma.session.count({ where: { userId: u.id, deletedAt: null, startedAt: { gte: windowStart } } }),
          prisma.session.count({ where: { userId: u.id, deletedAt: null, endedAt: { gte: windowStart } } }),
          prisma.session.findFirst({ where: { userId: u.id, deletedAt: null, isOpen: true } }),
          prisma.session.findFirst({
            where: { userId: u.id, deletedAt: null },
            orderBy: { startedAt: 'desc' },
            select: { startedAt: true },
          }),
          prisma.session.findFirst({
            where: { userId: u.id, deletedAt: null, endedAt: { not: null } },
            orderBy: { endedAt: 'desc' },
            select: { endedAt: true },
          }),
          prisma.session.count({
            where: {
              userId: u.id,
              deletedAt: null,
              startedAt: { lt: dayEnd },
              OR: [{ endedAt: null }, { endedAt: { gt: dayStart } }],
            },
          }),
        ]);

        const hasOpenSession = Boolean(openSession);
        startedCount += startedInWindow;
        endedCount += endedInWindow;
        if (hasOpenSession) openCount += 1;

        const lastMs = Math.max(
          lastStarted?.startedAt?.getTime() ?? 0,
          lastEnded?.endedAt?.getTime() ?? 0,
        );
        const active = startedInWindow > 0 || endedInWindow > 0 || hasOpenSession;

        perUser.push({
          userId: u.id,
          githubLogin: u.githubLogin,
          name: u.name,
          email: u.email,
          role: u.role,
          timezone: tz,
          localDate: today,
          active,
          startedInWindow,
          endedInWindow,
          hasOpenSession,
          sessionsToday: todayCount,
          lastActivityAt: lastMs > 0 ? new Date(lastMs).toISOString() : null,
        });
      }

      const inactive = perUser.filter((u) => !u.active);

      return {
        now: now.toISOString(),
        windowMinutes,
        windowStart: windowStart.toISOString(),
        hasActivity: startedCount > 0 || endedCount > 0 || openCount > 0,
        startedCount,
        endedCount,
        openCount,
        userCount: users.length,
        inactiveCount: inactive.length,
        appUrl: env.APP_BASE_URL,
        signInUrl: `${env.APP_BASE_URL}/auth/github`,
        inactive: inactive.map((u) => ({ githubLogin: u.githubLogin, email: u.email, name: u.name, timezone: u.timezone })),
        users: perUser,
      };
    },
  );
}
