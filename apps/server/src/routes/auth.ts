import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { prisma } from '@cadence/db';
import type { Me } from '@cadence/shared';
import { env } from '../env';
import { clearSession, getSessionUserId, setSession } from '../auth/session';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchGitHubUser,
  fetchUserEmails,
} from '../auth/githubOauth';

const STATE_COOKIE = 'cad_oauth_state';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // ── Begin OAuth (identity) ────────────────────────────────────────────────
  app.get('/auth/github', async (_req, reply) => {
    if (!env.GITHUB_CLIENT_ID) {
      return reply.code(503).send({ error: 'github_oauth_not_configured' });
    }
    const state = randomBytes(16).toString('hex');
    reply.setCookie(STATE_COOKIE, state, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      secure: env.isProd,
      path: '/',
      maxAge: 600,
    });
    return reply.redirect(buildAuthorizeUrl(state));
  });

  // ── OAuth callback ────────────────────────────────────────────────────────
  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/auth/github/callback',
    async (req, reply) => {
      const { code, state } = req.query;
      const signed = req.cookies[STATE_COOKIE];
      const expected = signed ? req.unsignCookie(signed) : { valid: false, value: null };
      if (!code || !state || !expected.valid || expected.value !== state) {
        return reply.code(400).send({ error: 'invalid_oauth_state' });
      }
      reply.clearCookie(STATE_COOKIE, { path: '/' });

      const token = await exchangeCodeForToken(code);
      const gh = await fetchGitHubUser(token);
      const emails = await fetchUserEmails(token);
      const primary = emails.find((e) => e.primary)?.email ?? gh.email ?? null;

      const isBootstrapAdmin = env.ADMIN_GITHUB_LOGINS.includes(gh.login.toLowerCase());
      const user = await prisma.user.upsert({
        where: { githubId: BigInt(gh.id) },
        create: {
          githubId: BigInt(gh.id),
          githubLogin: gh.login,
          name: gh.name,
          email: primary,
          avatarUrl: gh.avatar_url,
          role: isBootstrapAdmin ? 'admin' : 'dev',
        },
        update: {
          githubLogin: gh.login,
          name: gh.name,
          email: primary,
          avatarUrl: gh.avatar_url,
          deletedAt: null,
          // Promote bootstrap admins; never auto-demote anyone else here.
          ...(isBootstrapAdmin ? { role: 'admin' } : {}),
        },
      });

      // Seed UserEmail aliases for verified addresses (commit-author matching, §4).
      for (const e of emails) {
        if (!e.verified) continue;
        await prisma.userEmail.upsert({
          where: { email: e.email.toLowerCase() },
          create: { email: e.email.toLowerCase(), userId: user.id },
          update: {},
        });
      }

      setSession(reply, user.id);
      return reply.redirect('/');
    },
  );

  app.post('/auth/logout', async (_req, reply) => {
    clearSession(reply);
    return reply.send({ ok: true });
  });

  // ── Current user ──────────────────────────────────────────────────────────
  app.get('/me', async (req, reply) => {
    const userId = getSessionUserId(req);
    if (!userId) return reply.code(401).send({ error: 'not_authenticated' });
    const user = await prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user) {
      clearSession(reply);
      return reply.code(401).send({ error: 'not_authenticated' });
    }
    const me: Me = {
      id: user.id,
      githubLogin: user.githubLogin,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: user.role,
    };
    return me;
  });

  // ── Email aliases (confirm screen, §4) ────────────────────────────────────
  app.get('/me/emails', async (req, reply) => {
    const userId = getSessionUserId(req);
    if (!userId) return reply.code(401).send({ error: 'not_authenticated' });
    const emails = await prisma.userEmail.findMany({ where: { userId } });
    return { emails: emails.map((e) => e.email) };
  });

  app.post<{ Body: { email?: string } }>('/me/emails', async (req, reply) => {
    const userId = getSessionUserId(req);
    if (!userId) return reply.code(401).send({ error: 'not_authenticated' });
    const email = req.body?.email?.toLowerCase().trim();
    if (!email || !email.includes('@')) return reply.code(400).send({ error: 'invalid_email' });
    const created = await prisma.userEmail.upsert({
      where: { email },
      create: { email, userId },
      update: {},
    });
    return { email: created.email };
  });
}
