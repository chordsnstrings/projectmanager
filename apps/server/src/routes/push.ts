import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import { env } from '../env';
import { requireUser } from '../auth/require';

interface SubscribeBody {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
}

export async function pushRoutes(app: FastifyInstance): Promise<void> {
  // The client needs the VAPID public key to subscribe. Also reports whether
  // push is configured at all (so the UI can hide the toggle when it isn't).
  app.get('/push/public-key', async () => {
    return { enabled: env.pushEnabled, key: env.pushEnabled ? env.VAPID_PUBLIC_KEY : null };
  });

  // Register (or refresh) this device's subscription for the signed-in user.
  app.post<{ Body: SubscribeBody }>('/push/subscribe', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    if (!env.pushEnabled) return reply.code(503).send({ error: 'push_disabled' });
    const { endpoint, keys } = req.body ?? {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return reply.code(400).send({ error: 'invalid_subscription' });
    }
    const userAgent = (req.headers['user-agent'] ?? '').slice(0, 255) || null;
    // Endpoint is globally unique. If it already exists (even on another user or
    // soft-deleted), reclaim it for the current user and reactivate.
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      create: { userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
      update: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth, userAgent, deletedAt: null },
    });
    return reply.code(201).send({ ok: true });
  });

  // Unsubscribe this device (soft-delete by endpoint).
  app.post<{ Body: { endpoint?: string } }>('/push/unsubscribe', async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const endpoint = req.body?.endpoint;
    if (endpoint) {
      await prisma.pushSubscription.updateMany({
        where: { endpoint, userId: user.id, deletedAt: null },
        data: { deletedAt: new Date() },
      });
    }
    return { ok: true };
  });
}
