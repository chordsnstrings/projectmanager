import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import { env } from '../env';
import { verifyWebhookSignature } from '../webhooks/verify';
import { routeWebhook } from '../webhooks/router';

// In-memory dedupe of recently seen delivery ids (idempotency; DB unique is the
// durable guard via GitEvent.deliveryId).
const seenDeliveries = new Set<string>();
function rememberDelivery(id: string): boolean {
  if (seenDeliveries.has(id)) return false;
  seenDeliveries.add(id);
  if (seenDeliveries.size > 5000) {
    // bound memory
    for (const k of seenDeliveries) {
      seenDeliveries.delete(k);
      if (seenDeliveries.size <= 2500) break;
    }
  }
  return true;
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/webhooks/github', async (req, reply) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const deliveryId = (req.headers['x-github-delivery'] as string | undefined) ?? '';
    const event = (req.headers['x-github-event'] as string | undefined) ?? '';
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';

    // Verify BEFORE trusting the parsed body (§4).
    if (!verifyWebhookSignature(env.GITHUB_WEBHOOK_SECRET, raw, signature)) {
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    // Return 2xx fast; do the work async in-process (low volume, §4).
    reply.code(202).send({ ok: true });

    if (!deliveryId || !rememberDelivery(deliveryId)) return;
    const payload = req.body as Record<string, unknown>;
    routeWebhook(prisma, { event, deliveryId, payload }).catch((err) => {
      app.log.error({ err, event, deliveryId }, 'webhook processing failed');
    });
  });
}
