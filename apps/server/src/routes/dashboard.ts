import type { FastifyInstance } from 'fastify';
import { canViewUser, requireAdmin, requireUser } from '../auth/require';
import { buildDayTimeline, buildTeamDashboard, buildTeamDay, buildTrends } from '../services/dashboard';
import { mailConfigured, verifyMail } from '../email/mailer';
import { sendAdminDigest, sendDevDigests } from '../scripts/digest';
import { runLoginCheck } from '../scripts/loginCheck';

function parseRange(q: { from?: string; to?: string }): { start: Date; end: Date } {
  const end = q.to ? new Date(q.to) : new Date();
  const start = q.from
    ? new Date(q.from)
    : new Date(`${end.toISOString().slice(0, 10)}T00:00:00.000Z`);
  return { start, end };
}

export async function dashboardRoutes(app: FastifyInstance): Promise<void> {
  // Team overview (admin only).
  app.get<{ Querystring: { from?: string; to?: string } }>(
    '/dashboard/team',
    async (req, reply) => {
      const admin = await requireAdmin(req, reply);
      if (!admin) return;
      const { start, end } = parseRange(req.query);
      return buildTeamDashboard(start, end);
    },
  );

  // Whole-team day on a shared axis (admin only).
  app.get<{ Querystring: { date?: string } }>('/dashboard/team/day', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    return buildTeamDay(admin.id, req.query.date);
  });

  // Per-person day timeline (admin or self).
  app.get<{ Params: { id: string }; Querystring: { date?: string } }>(
    '/dashboard/user/:id/day',
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      if (!canViewUser(user, req.params.id, reply)) return;
      return buildDayTimeline(req.params.id, req.query.date);
    },
  );

  // Longitudinal trends (admin or self).
  app.get<{ Params: { id: string }; Querystring: { weeks?: string } }>(
    '/dashboard/user/:id/trends',
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      if (!canViewUser(user, req.params.id, reply)) return;
      const weeks = req.query.weeks ? Math.min(26, Math.max(1, Number(req.query.weeks))) : 8;
      return buildTrends(req.params.id, weeks);
    },
  );

  // Send the digest emails now (admin only) — for verifying SMTP + previewing
  // what recipients receive. ?devs=1 also fires the per-dev nudges.
  app.post<{ Querystring: { devs?: string } }>('/dashboard/send-digest', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    if (!mailConfigured()) {
      return reply.code(503).send({ error: 'smtp_not_configured' });
    }
    const verified = await verifyMail();
    const adminRecipients = await sendAdminDigest();
    const devsSent = req.query.devs === '1' ? await sendDevDigests() : 0;
    return { verified, adminRecipients, devsSent };
  });

  // Run the login-reminder check now (admin only) — bypasses the daily/Friday
  // gate so it can be tested on demand.
  app.post('/dashboard/run-login-check', async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    if (!mailConfigured()) return reply.code(503).send({ error: 'smtp_not_configured' });
    return runLoginCheck(false);
  });
}
