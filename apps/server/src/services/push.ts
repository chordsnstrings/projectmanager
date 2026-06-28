// Web Push (VAPID) delivery. Best-effort: every send is fire-and-forget from the
// caller's perspective (callers `void push...()` so a push never blocks or fails
// the request that triggered it). Dead subscriptions (404/410 from the push
// service) are soft-deleted so we stop trying them.
import webpush from 'web-push';
import { prisma } from '@cadence/db';
import { env } from '../env';

let configured = false;
function ensureConfigured(): boolean {
  if (!env.pushEnabled) return false;
  if (!configured) {
    webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    configured = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** in-app path to open on tap, e.g. "/board" or "/admin/questions" */
  url?: string;
  /** coalescing key — a newer push with the same tag replaces the old one */
  tag?: string;
}

/** Send a notification to every live subscription of one user. No-op if push is off. */
export async function pushToUser(userId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId, deletedAt: null } });
  if (subs.length === 0) return;
  const body = JSON.stringify({ ...payload, url: payload.url ?? '/' });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) {
          // Subscription is gone — retire it.
          await prisma.pushSubscription.update({ where: { id: s.id }, data: { deletedAt: new Date() } }).catch(() => {});
        } else {
          console.log(JSON.stringify({ audit: 'push.error', userId, code: code ?? 'unknown' }));
        }
      }
    }),
  );
}

/** Fan out to several users (deduped). */
export async function pushToUsers(userIds: (string | null | undefined)[], payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;
  const unique = [...new Set(userIds.filter((id): id is string => !!id))];
  await Promise.all(unique.map((id) => pushToUser(id, payload)));
}
