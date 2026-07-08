import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import type { HealthStatus } from '@cadence/shared';
import { env } from './env';
import { authRoutes } from './routes/auth';
import { webhookRoutes } from './routes/webhooks';
import { taskRoutes } from './routes/tasks';
import { sessionRoutes } from './routes/sessions';
import { flagRoutes } from './routes/flags';
import { questionRoutes } from './routes/questions';
import { checkinRoutes } from './routes/checkin';
import { pushRoutes } from './routes/push';
import { meetingRoutes } from './routes/meetings';
import { dashboardRoutes } from './routes/dashboard';
import { directoryRoutes } from './routes/directory';
import { integrationRoutes } from './routes/integrations';
import { progressRoutes } from './routes/progress';

/** Build the Fastify app (exported so tests can import without binding a port). */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.isProd ? 'info' : 'info' },
    trustProxy: true,
  });

  // Capture the raw JSON body (needed for webhook HMAC verification) while still
  // parsing JSON for normal routes.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      (req as unknown as { rawBody?: string }).rawBody = body as string;
      if (!body) return done(null, {});
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  // Security headers. CSP is disabled (the SPA loads hashed assets same-origin);
  // other protections (frameguard, noSniff, etc.) stay on.
  await app.register(fastifyHelmet, { contentSecurityPolicy: false });

  // Rate limiting (P6): bounds auth + webhook abuse. Generous for 30s polling.
  await app.register(fastifyRateLimit, {
    max: 300,
    timeWindow: '1 minute',
    allowList: (req) => req.url === '/healthz',
  });

  await app.register(fastifyCookie, { secret: env.SESSION_SECRET || 'dev-insecure-secret' });

  // ── Health check (DO health probe + P0 gate) ──────────────────────────────
  app.get('/healthz', async (): Promise<HealthStatus> => {
    return { status: 'ok', time: new Date().toISOString() };
  });

  await app.register(authRoutes);
  await app.register(webhookRoutes);
  await app.register(taskRoutes);
  await app.register(sessionRoutes);
  await app.register(flagRoutes);
  await app.register(questionRoutes);
  await app.register(checkinRoutes);
  await app.register(pushRoutes);
  await app.register(meetingRoutes);
  await app.register(dashboardRoutes);
  await app.register(directoryRoutes);
  await app.register(integrationRoutes);
  await app.register(progressRoutes);

  // ── Static SPA (apps/web/dist), with history-API fallback ─────────────────
  const webDist = resolve(__dirname, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if ((req.raw.url && req.raw.url.startsWith('/api')) || req.method !== 'GET') {
        return reply.code(404).send({ error: 'not_found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.log.warn(`web dist not found at ${webDist} — SPA will not be served (build apps/web)`);
  }

  return app;
}
