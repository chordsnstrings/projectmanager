// Email digest rendering — pure functions (data → subject/html/text) so they're
// unit-testable without SMTP. The HTML uses inline styles only (email clients
// strip <style> blocks) and echoes the dark "engineering instrument" palette.
import type { TeamDashboard, TeamMemberRollup } from '@cadence/shared';
import { env } from '../env';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const C = {
  bg: '#15171c',
  panel: '#1c1f26',
  surface: '#21252e',
  text: '#e8eaed',
  text2: '#9aa0aa',
  text3: '#686d77',
  border: 'rgba(255,255,255,.10)',
  brass: '#c8a96a',
  danger: '#ef5b5b',
  success: '#5bc07a',
};

const MONO = "ui-monospace,SFMono-Regular,Menlo,monospace";
const SANS = "system-ui,-apple-system,Segoe UI,Roboto,sans-serif";

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function fmtMins(m: number): string {
  const mins = Math.max(0, Math.round(m));
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  if (h > 0) return `${h}h ${mm}m`;
  return `${mm}m`;
}

function shell(title: string, inner: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${C.bg};">
  <div style="max-width:640px;margin:0 auto;padding:28px 20px;font-family:${SANS};color:${C.text};">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
      <span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${C.brass};"></span>
      <span style="font-weight:600;letter-spacing:.3px;">Cadence</span>
    </div>
    <h1 style="font-size:18px;font-weight:600;margin:8px 0 18px;color:${C.text};">${esc(title)}</h1>
    ${inner}
    <p style="margin-top:28px;font-family:${MONO};font-size:11px;color:${C.text3};">
      Cadence · session-based engineering visibility · <a href="${esc(env.APP_BASE_URL)}" style="color:${C.brass};text-decoration:none;">open dashboard</a>
    </p>
  </div></body></html>`;
}

function chip(label: string, color: string): string {
  return `<span style="display:inline-block;font-family:${MONO};font-size:11px;color:${color};border:1px solid ${C.border};border-radius:6px;padding:1px 6px;">${esc(label)}</span>`;
}

// ── Admin team digest ────────────────────────────────────────────────────────
export function renderAdminDigest(
  dash: TeamDashboard,
  opts: { dateLabel: string; openFlags: number; openQuestions: number },
): RenderedMail {
  const members = [...dash.members].sort((a, b) => b.activeElapsedMinutes - a.activeElapsedMinutes);
  const active = members.filter((m) => m.activeElapsedMinutes > 0 || m.sessionCount > 0);
  const idle = members.filter((m) => m.activeElapsedMinutes === 0 && m.sessionCount === 0);

  const summary = `
    <table style="width:100%;border-collapse:collapse;margin-bottom:18px;">
      <tr>
        ${summaryCell('active', String(active.length), C.text)}
        ${summaryCell('open flags', String(opts.openFlags), opts.openFlags > 0 ? C.danger : C.text2)}
        ${summaryCell('unanswered Q', String(opts.openQuestions), opts.openQuestions > 0 ? C.brass : C.text2)}
      </tr>
    </table>`;

  const rows = active.map(memberRow).join('');
  const activeTable = active.length
    ? `<table style="width:100%;border-collapse:collapse;background:${C.panel};border:1px solid ${C.border};border-radius:10px;overflow:hidden;">${rows}</table>`
    : `<p style="color:${C.text3};font-size:13px;">No tracked sessions in this window.</p>`;

  const idleNote = idle.length
    ? `<p style="margin-top:14px;font-size:12px;color:${C.text3};">No activity: ${idle
        .map((m) => `<span style="font-family:${MONO};">${esc(m.githubLogin)}</span>`)
        .join(', ')}</p>`
    : '';

  const title = `Team digest · ${opts.dateLabel}`;
  const html = shell(title, summary + activeTable + idleNote);

  const text =
    `Cadence — ${title}\n` +
    `active ${active.length} · open flags ${opts.openFlags} · unanswered questions ${opts.openQuestions}\n\n` +
    active
      .map(
        (m) =>
          `${m.githubLogin}: ${fmtMins(m.activeElapsedMinutes)} elapsed, ${m.sessionCount} sessions, ` +
          `${m.openFlagCount} flags${m.runningTaskTitles.length ? `, running: ${m.runningTaskTitles.join(', ')}` : ''}`,
      )
      .join('\n') +
    (idle.length ? `\n\nNo activity: ${idle.map((m) => m.githubLogin).join(', ')}` : '') +
    `\n\n${env.APP_BASE_URL}`;

  return { subject: `Cadence team digest — ${opts.dateLabel}`, html, text };
}

function summaryCell(label: string, value: string, color: string): string {
  return `<td style="width:33%;background:${C.panel};border:1px solid ${C.border};border-radius:10px;padding:12px 14px;text-align:center;">
    <div style="font-family:${MONO};font-size:22px;font-weight:600;color:${color};">${esc(value)}</div>
    <div style="font-size:11px;color:${C.text3};letter-spacing:.4px;margin-top:2px;">${esc(label)}</div>
  </td>`;
}

function memberRow(m: TeamMemberRollup): string {
  const running = m.runningTaskTitles.length
    ? `<div style="margin-top:3px;">${m.runningTaskTitles
        .map((t) => chip(t, C.success))
        .join(' ')}</div>`
    : '';
  const flags = m.openFlagCount > 0 ? chip(`${m.openFlagCount} flag${m.openFlagCount === 1 ? '' : 's'}`, C.danger) : '';
  return `<tr style="border-top:1px solid ${C.border};">
    <td style="padding:11px 14px;vertical-align:top;">
      <div style="font-family:${MONO};font-size:13px;color:${C.text};">${esc(m.githubLogin)}</div>
      ${running}
    </td>
    <td style="padding:11px 14px;text-align:right;white-space:nowrap;vertical-align:top;">
      <span style="font-family:${MONO};font-size:13px;color:${C.text};">${fmtMins(m.activeElapsedMinutes)}</span>
      <span style="font-size:11px;color:${C.text3};"> · ${m.sessionCount} sess</span>
      ${flags ? ` ${flags}` : ''}
    </td>
  </tr>`;
}

// ── Per-dev nudge digest ─────────────────────────────────────────────────────
export interface DevDigestData {
  login: string;
  name: string | null;
  flags: { type: string; detail: string | null }[];
  questions: { body: string; blocksNext: boolean }[];
}

/** Returns null when there's nothing actionable (so the caller skips sending). */
export function renderDevDigest(d: DevDigestData): RenderedMail | null {
  if (d.flags.length === 0 && d.questions.length === 0) return null;

  const qBlock = d.questions.length
    ? `<div style="margin-bottom:16px;">
        <div style="font-size:12px;color:${C.brass};font-weight:600;margin-bottom:8px;">Questions to answer</div>
        ${d.questions
          .map(
            (q) =>
              `<div style="background:${C.panel};border:1px solid ${C.border};border-radius:8px;padding:10px 12px;margin-bottom:6px;">
                ${q.blocksNext ? `${chip('blocks next', C.danger)} ` : ''}
                <span style="font-size:13px;color:${C.text};">${esc(q.body)}</span>
              </div>`,
          )
          .join('')}
      </div>`
    : '';

  const fBlock = d.flags.length
    ? `<div>
        <div style="font-size:12px;color:${C.text2};font-weight:600;margin-bottom:8px;">Open flags</div>
        ${d.flags
          .map(
            (f) =>
              `<div style="background:${C.panel};border:1px solid ${C.border};border-radius:8px;padding:10px 12px;margin-bottom:6px;">
                ${chip(f.type, C.danger)}
                <span style="font-size:13px;color:${C.text2};"> ${esc(f.detail ?? '')}</span>
              </div>`,
          )
          .join('')}
      </div>`
    : '';

  const title = 'Your open items';
  const html = shell(title, qBlock + fBlock);

  const text =
    `Cadence — ${title} (@${d.login})\n\n` +
    (d.questions.length
      ? 'Questions to answer:\n' +
        d.questions.map((q) => `- ${q.blocksNext ? '[blocks next] ' : ''}${q.body}`).join('\n') +
        '\n\n'
      : '') +
    (d.flags.length
      ? 'Open flags:\n' + d.flags.map((f) => `- ${f.type}: ${f.detail ?? ''}`).join('\n') + '\n\n'
      : '') +
    env.APP_BASE_URL;

  const blocking = d.questions.some((q) => q.blocksNext);
  const subject = blocking
    ? 'Cadence — you have a blocking question to answer'
    : `Cadence — ${d.questions.length + d.flags.length} open item${d.questions.length + d.flags.length === 1 ? '' : 's'}`;

  return { subject, html, text };
}
