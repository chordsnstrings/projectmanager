import type { FastifyInstance } from 'fastify';
import { assertCanViewUser, requireUser } from '../auth/require';
import { buildProductivity, buildProgress, listCompletions } from '../services/progress';

export async function progressRoutes(app: FastifyInstance): Promise<void> {
  // Board summary for the signed-in dev (today + last 7 days).
  app.get('/me/productivity', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    return buildProductivity(user.id);
  });

  // Weekly progress + milestone + version rollups (self or admin).
  app.get<{ Params: { id: string }; Querystring: { weeks?: string } }>(
    '/dashboard/user/:id/progress',
    async (req, reply) => {
      const user = await requireUser(req, reply);
      if (!user) return;
      if (!(await assertCanViewUser(user, req.params.id, reply))) return;
      const weeks = req.query.weeks ? Math.min(26, Math.max(1, Number(req.query.weeks))) : 8;
      return buildProgress(req.params.id, weeks);
    },
  );

  // Completion log (done tasks). Members see their own; managers may target a
  // viewable ?userId (owner: anyone; lead: own team).
  app.get<{ Querystring: { userId?: string; cursor?: string } }>('/completions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    let targetUserId = user.id;
    if (req.query.userId && req.query.userId !== user.id) {
      if (!(await assertCanViewUser(user, req.query.userId, reply))) return;
      targetUserId = req.query.userId;
    }
    return listCompletions(targetUserId, req.query.cursor);
  });
}
