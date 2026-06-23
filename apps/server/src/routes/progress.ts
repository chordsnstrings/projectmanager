import type { FastifyInstance } from 'fastify';
import { canViewUser, requireUser } from '../auth/require';
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
      if (!canViewUser(user, req.params.id, reply)) return;
      const weeks = req.query.weeks ? Math.min(26, Math.max(1, Number(req.query.weeks))) : 8;
      return buildProgress(req.params.id, weeks);
    },
  );

  // Completion log (done tasks). Devs see their own; admins may target ?userId=.
  app.get<{ Querystring: { userId?: string; cursor?: string } }>('/completions', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const targetUserId = user.role === 'admin' && req.query.userId ? req.query.userId : user.id;
    return listCompletions(targetUserId, req.query.cursor);
  });
}
