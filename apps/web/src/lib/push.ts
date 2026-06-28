// Web Push subscription helpers (client side). The service worker is registered
// in main.tsx; here we manage the PushSubscription and sync it with the server.
import { api } from './api';

export type PushState =
  | 'unsupported' // browser/SW/Notification API missing
  | 'disabled' // server has no VAPID keys configured
  | 'denied' // user blocked notifications
  | 'off' // supported + allowed but not subscribed
  | 'on'; // subscribed and registered with the server

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function serverKey(): Promise<string | null> {
  const r = await api<{ enabled: boolean; key: string | null }>('/push/public-key').catch(() => null);
  return r?.enabled ? r.key : null;
}

/** Current state for the toggle, without prompting. */
export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const key = await serverKey();
  if (!key) return 'disabled';
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? 'on' : 'off';
}

/** Prompt (if needed), subscribe, and register with the server. Returns the new state. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const key = await serverKey();
  if (!key) return 'disabled';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
    });
  }
  const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  await api('/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
  return 'on';
}

/** Unsubscribe this device and tell the server to retire it. */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const reg = await navigator.serviceWorker.ready.catch(() => null);
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (sub) {
    await api('/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  return 'off';
}
