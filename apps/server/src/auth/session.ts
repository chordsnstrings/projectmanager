import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../env';

export const SESSION_COOKIE = 'cad_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Issue a signed, httpOnly session cookie carrying the user id. */
export function setSession(reply: FastifyReply, userId: string): void {
  reply.setCookie(SESSION_COOKIE, userId, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd,
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

/** Clear the session cookie. */
export function clearSession(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Resolve the authenticated user id from the signed cookie, or null. */
export function getSessionUserId(req: FastifyRequest): string | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const unsigned = req.unsignCookie(raw);
  return unsigned.valid && unsigned.value ? unsigned.value : null;
}
