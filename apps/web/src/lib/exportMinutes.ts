import type { MeetingMinutesDTO } from '@cadence/shared';

/** HTML-escape a cell value. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br/>');
}

/**
 * Export a Minutes of Meeting as a Word-openable .doc (HTML with the Word MIME).
 * No dependencies, no popup — a Blob download that opens cleanly in Word / Google
 * Docs and preserves the header + agenda table.
 */
export function exportMinutes(mom: MeetingMinutesDTO, who: string): void {
  const rows = mom.items
    .map(
      (it) => `<tr>
        <td>${esc(it.topic)}</td>
        <td>${esc(it.details)}</td>
        <td>${esc(it.decision)}</td>
        <td>${esc(it.responsible)}</td>
        <td>${esc(it.timeline)}</td>
        <td>${esc(it.remarks)}</td>
      </tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>Minutes of Meeting</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; color: #111; }
  h1 { font-size: 18px; margin: 0 0 12px; }
  table.meta td { padding: 2px 8px 2px 0; vertical-align: top; }
  table.meta td.k { color: #555; white-space: nowrap; }
  table.items { border-collapse: collapse; width: 100%; margin-top: 14px; font-size: 11px; }
  table.items th, table.items td { border: 1px solid #999; padding: 6px 8px; text-align: left; vertical-align: top; }
  table.items th { background: #f0f0f0; }
</style></head>
<body>
  <h1>Minutes of Meeting</h1>
  <table class="meta">
    <tr><td class="k">Date</td><td>${esc(mom.date)}</td></tr>
    <tr><td class="k">Members</td><td>${esc(mom.attendees)}</td></tr>
    <tr><td class="k">Agenda</td><td>${esc(mom.agenda)}</td></tr>
  </table>
  <table class="items">
    <thead><tr><th>Topic</th><th>Details</th><th>Decision</th><th>Responsible</th><th>Timeline</th><th>Remarks</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <p style="margin-top:16px;color:#888;font-size:10px;">Exported from Cadence · ${esc(who)}</p>
</body></html>`;

  const blob = new Blob(['﻿', html], { type: 'application/msword' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MoM_${mom.date || 'meeting'}.doc`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
