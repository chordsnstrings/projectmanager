import type { FastifyInstance } from 'fastify';
import type { CheckinSubmit } from '@cadence/shared';
import { managerTeamWhere, requireManager, requireUser } from '../auth/require';
import { buildCheckinInsights, buildCheckinPrompt, submitCheckin } from '../services/checkin';

export async function checkinRoutes(app: FastifyInstance): Promise<void> {
  // Is a check-in needed today? + yesterday recap + open tasks for the modal.
  app.get('/me/checkin', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return buildCheckinPrompt(user.id);
  });

  // Record today's check-in.
  app.post<{ Body: CheckinSubmit }>('/me/checkin', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await submitCheckin(user.id, req.body ?? {}, false);
    return { ok: true };
  });

  // Skip today's check-in (so it doesn't reappear until tomorrow).
  app.post('/me/checkin/skip', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    await submitCheckin(user.id, {}, true);
    return { ok: true };
  });

  // Admin/lead "Pulse": felt-vs-measured, sentiment, blockers, carry-over.
  app.get<{ Querystring: { team?: string; days?: string } }>('/dashboard/checkins', async (req, reply) => {
    const mgr = await requireManager(req, reply);
    if (!mgr) return;
    const where = await managerTeamWhere(mgr, req.query.team);
    const days = req.query.days ? Math.min(90, Math.max(7, Number(req.query.days))) : 28;
    return buildCheckinInsights(where, days);
  });
}
