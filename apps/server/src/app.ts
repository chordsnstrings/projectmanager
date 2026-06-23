import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { HealthStatus, Me } from '@cadence/shared';
import { env } from './env';

/** Build the Fastify app (exported so tests can import without binding a port). */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.isProd ? 'info' : 'info' },
    trustProxy: true,
  });

  // ── Health check (DO health probe + P0 gate) ──────────────────────────────
  app.get('/healthz', async (): Promise<HealthStatus> => {
    return { status: 'ok', time: new Date().toISOString() };
  });

  // ── Current user (stub until P1 auth lands) ───────────────────────────────
  app.get('/me', async (_req, reply): Promise<Me | void> => {
    return reply.code(401).send({ error: 'not_authenticated' });
  });

  // ── Static SPA (apps/web/dist), with history-API fallback ─────────────────
  // From apps/server/dist → ../../web/dist
  const webDist = resolve(__dirname, '../../web/dist');
  if (existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });

    app.setNotFoundHandler((req, reply) => {
      // Unknown API routes 404 as JSON; GET everything else gets the SPA shell.
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
