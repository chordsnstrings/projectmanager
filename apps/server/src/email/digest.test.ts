import { describe, expect, it } from 'vitest';
import type { TeamDashboard } from '@cadence/shared';
import { fmtMins, renderAdminDigest, renderDevDigest } from './digest';

describe('fmtMins', () => {
  it('formats minutes and hours', () => {
    expect(fmtMins(0)).toBe('0m');
    expect(fmtMins(45)).toBe('45m');
    expect(fmtMins(60)).toBe('1h 0m');
    expect(fmtMins(135)).toBe('2h 15m');
  });
});

const dash: TeamDashboard = {
  rangeStart: '2026-06-22T00:00:00.000Z',
  rangeEnd: '2026-06-23T00:00:00.000Z',
  members: [
    {
      userId: 'u1',
      githubLogin: 'shakil',
      name: 'Shakil',
      avatarUrl: null,
      activeElapsedMinutes: 200,
      taskHoursMinutes: 260,
      sessionCount: 3,
      openFlagCount: 2,
      runningTaskTitles: ['payments-api'],
      lastActiveAt: '2026-06-22T17:00:00.000Z',
      tasksClosed: 1,
      estimateAccuracy: 1.1,
    },
    {
      userId: 'u2',
      githubLogin: 'idle-dev',
      name: null,
      avatarUrl: null,
      activeElapsedMinutes: 0,
      taskHoursMinutes: 0,
      sessionCount: 0,
      openFlagCount: 0,
      runningTaskTitles: [],
      lastActiveAt: null,
      tasksClosed: 0,
      estimateAccuracy: null,
    },
  ],
};

describe('renderAdminDigest', () => {
  it('summarises active members and lists idle ones', () => {
    const mail = renderAdminDigest(dash, { dateLabel: '2026-06-22', openFlags: 2, openQuestions: 1 });
    expect(mail.subject).toContain('2026-06-22');
    expect(mail.html).toContain('shakil');
    expect(mail.html).toContain('payments-api');
    expect(mail.html).toContain('3h 20m'); // 200 minutes
    // idle dev shown in the "no activity" note, not the main table rows
    expect(mail.text).toContain('No activity: idle-dev');
  });

  it('escapes HTML in task titles', () => {
    const evil: TeamDashboard = {
      ...dash,
      members: [{ ...dash.members[0]!, runningTaskTitles: ['<script>x</script>'] }],
    };
    const mail = renderAdminDigest(evil, { dateLabel: 'd', openFlags: 0, openQuestions: 0 });
    expect(mail.html).not.toContain('<script>x</script>');
    expect(mail.html).toContain('&lt;script&gt;');
  });
});

describe('renderDevDigest', () => {
  it('returns null with nothing actionable', () => {
    expect(renderDevDigest({ login: 'a', name: null, flags: [], questions: [] })).toBeNull();
  });

  it('flags a blocking question in the subject', () => {
    const mail = renderDevDigest({
      login: 'shakil',
      name: 'Shakil',
      flags: [{ type: 'open_no_activity', detail: 'idle 2h' }],
      questions: [{ body: 'Why the rollback?', blocksNext: true }],
    });
    expect(mail).not.toBeNull();
    expect(mail!.subject).toContain('blocking');
    expect(mail!.html).toContain('Why the rollback?');
    expect(mail!.html).toContain('blocks next');
  });
});
