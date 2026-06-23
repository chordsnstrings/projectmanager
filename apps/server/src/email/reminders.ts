// Login-reminder email rendering — pure functions (data → subject/html/text),
// inline-styled, HTML-escaped. Sent when a user hasn't signed in recently.
import { env } from '../env';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const C = {
  bg: '#15171c',
  panel: '#1c1f26',
  text: '#e8eaed',
  text2: '#9aa0aa',
  text3: '#686d77',
  border: 'rgba(255,255,255,.10)',
  brass: '#c8a96a',
  danger: '#ef5b5b',
};
const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
const SANS = 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function shell(title: string, inner: string, accent = C.brass): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${C.bg};">
  <div style="max-width:560px;margin:0 auto;padding:28px 20px;font-family:${SANS};color:${C.text};">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${accent};"></span>
      <span style="font-weight:600;letter-spacing:.3px;">Cadence</span>
    </div>
    <h1 style="font-size:18px;font-weight:600;margin:8px 0 14px;color:${C.text};">${esc(title)}</h1>
    ${inner}
  </div></body></html>`;
}

function button(label: string, url: string, accent = C.brass): string {
  return `<a href="${esc(url)}" style="display:inline-block;margin-top:14px;padding:10px 16px;border-radius:8px;background:${accent};color:#15171c;font-weight:600;text-decoration:none;font-size:14px;">${esc(label)}</a>`;
}

const signInUrl = () => `${env.APP_BASE_URL}/auth/github`;

/** Reminder to an individual user who hasn't logged in. */
export function renderUserReminder(opts: { login: string; name: string | null; hours: number }): RenderedMail {
  const who = opts.name?.split(' ')[0] || opts.login;
  const inner = `
    <p style="font-size:14px;color:${C.text2};line-height:1.5;">
      Hi ${esc(who)} — we haven't seen you sign in to Cadence in about
      <strong style="color:${C.text};">${Math.round(opts.hours)}h</strong>.
      Please log in and start a session so your work is tracked.
    </p>
    ${button('Log in with GitHub', signInUrl())}
    <p style="margin-top:16px;font-family:${MONO};font-size:11px;color:${C.text3};">${esc(signInUrl())}</p>`;
  return {
    subject: 'Reminder: please log in to Cadence',
    html: shell('Time to log in', inner),
    text: `Hi ${who} — we haven't seen you sign in to Cadence in about ${Math.round(opts.hours)}h.\nPlease log in: ${signInUrl()}`,
  };
}

export interface InactiveEntry {
  login: string;
  name: string | null;
  hours: number;
  emailed: boolean;
}

/** Admin summary of who hasn't logged in (24h tier). */
export function renderAdminInactivity(entries: InactiveEntry[]): RenderedMail {
  const rows = entries
    .map(
      (e) =>
        `<tr style="border-top:1px solid ${C.border};">
          <td style="padding:9px 12px;font-family:${MONO};font-size:13px;color:${C.text};">${esc(e.login)}</td>
          <td style="padding:9px 12px;font-family:${MONO};font-size:12px;color:${C.text2};text-align:right;">no login ${Math.round(e.hours)}h</td>
          <td style="padding:9px 12px;font-family:${MONO};font-size:11px;color:${e.emailed ? C.brass : C.text3};text-align:right;">${e.emailed ? 'reminded' : '—'}</td>
        </tr>`,
    )
    .join('');
  const inner = `
    <p style="font-size:14px;color:${C.text2};line-height:1.5;">
      ${entries.length} team member${entries.length === 1 ? '' : 's'} haven't logged in to Cadence in the last 24 hours.
      A reminder was emailed to each.
    </p>
    <table style="width:100%;border-collapse:collapse;background:${C.panel};border:1px solid ${C.border};border-radius:10px;overflow:hidden;margin-top:10px;">${rows}</table>`;
  return {
    subject: `Cadence: ${entries.length} member${entries.length === 1 ? '' : 's'} not logged in (24h)`,
    html: shell('No-login report', inner),
    text:
      `${entries.length} member(s) have not logged in to Cadence in 24h (reminders sent):\n` +
      entries.map((e) => `- ${e.login}: no login ${Math.round(e.hours)}h${e.emailed ? ' (reminded)' : ''}`).join('\n'),
  };
}

/** URGENT alert (48h tier) → admins + external recipients. */
export function renderUrgentInactivity(entries: InactiveEntry[]): RenderedMail {
  const rows = entries
    .map(
      (e) =>
        `<tr style="border-top:1px solid ${C.border};">
          <td style="padding:9px 12px;font-family:${MONO};font-size:13px;color:${C.text};">${esc(e.login)}${e.name ? ` <span style="color:${C.text3};">(${esc(e.name)})</span>` : ''}</td>
          <td style="padding:9px 12px;font-family:${MONO};font-size:12px;color:${C.danger};text-align:right;">no login ${Math.round(e.hours)}h</td>
        </tr>`,
    )
    .join('');
  const inner = `
    <p style="font-size:14px;color:${C.text2};line-height:1.5;">
      <strong style="color:${C.danger};">URGENT.</strong> The following member${entries.length === 1 ? ' has' : 's have'}
      not logged in to Cadence for 48 hours or more (Fridays excluded):
    </p>
    <table style="width:100%;border-collapse:collapse;background:${C.panel};border:1px solid ${C.danger}40;border-radius:10px;overflow:hidden;margin-top:10px;">${rows}</table>`;
  return {
    subject: `URGENT — Cadence: ${entries.length} member${entries.length === 1 ? '' : 's'} not logged in (48h+)`,
    html: shell('URGENT: prolonged no-login', inner, C.danger),
    text:
      `URGENT — the following have not logged in to Cadence for 48h+ (Fridays excluded):\n` +
      entries.map((e) => `- ${e.login}${e.name ? ` (${e.name})` : ''}: no login ${Math.round(e.hours)}h`).join('\n'),
  };
}
