import { describe, expect, it } from 'vitest';
import { hasConcurrency, sumMinutes, unionMinutes } from './sessionMath';
import { dominantActivity, inferActivityFromMessage } from './activity';
import { extractIssueRefs } from './attribution';
import { activityNoSession, longOpenSession, openNoActivity, overrun } from './flags';

const T = (h: number, m = 0) => new Date(2026, 5, 23, h, m).getTime();

describe('sessionMath', () => {
  it('union counts overlap once; sum double-counts', () => {
    const ivs = [
      { start: T(9), end: T(11) }, // 120m
      { start: T(10), end: T(12) }, // overlaps 9-11 by 60m
    ];
    expect(unionMinutes(ivs)).toBe(180); // 9–12
    expect(sumMinutes(ivs)).toBe(240); // 120 + 120
    expect(hasConcurrency(ivs)).toBe(true);
  });
  it('non-overlapping union == sum', () => {
    const ivs = [
      { start: T(9), end: T(10) },
      { start: T(11), end: T(12) },
    ];
    expect(unionMinutes(ivs)).toBe(120);
    expect(sumMinutes(ivs)).toBe(120);
    expect(hasConcurrency(ivs)).toBe(false);
  });
});

describe('activity inference', () => {
  it('classifies messages', () => {
    expect(inferActivityFromMessage('fix: null ptr')).toBe('debugging');
    expect(inferActivityFromMessage('feat: add widget')).toBe('coding');
    expect(inferActivityFromMessage('refactor cleanup')).toBe('coding');
  });
  it('no commits reads as research; big additions read as agent', () => {
    expect(dominantActivity([])).toBe('research');
    expect(dominantActivity([{ message: 'feat: x', additions: 800, occurredAt: T(9) }])).toBe('agent');
  });
});

describe('extractIssueRefs', () => {
  it('parses #N, Closes #N, owner/repo#N', () => {
    expect(extractIssueRefs('Closes #42 and #7')).toEqual([42, 7]);
    expect(extractIssueRefs('see chordsnstrings/projectmanager#99')).toEqual([99]);
    expect(extractIssueRefs('no refs here')).toEqual([]);
  });
});

describe('flags', () => {
  const now = T(18);
  it('open_no_activity fires for idle open session', () => {
    const s = { id: 's1', userId: 'u1', taskId: 't1', startedAt: T(16), endedAt: null, innerGitEvents: 0 };
    expect(openNoActivity(s, now, 90)?.type).toBe('open_no_activity');
    expect(openNoActivity({ ...s, innerGitEvents: 2 }, now, 90)).toBeNull();
    expect(openNoActivity({ ...s, endedAt: T(17) }, now, 90)).toBeNull();
  });
  it('long_open_session fires past max hours', () => {
    const s = { id: 's1', userId: 'u1', taskId: 't1', startedAt: T(2), endedAt: null, innerGitEvents: 5 };
    expect(longOpenSession(s, now, 8)?.type).toBe('long_open_session');
  });
  it('overrun needs an estimate and assignee', () => {
    expect(overrun({ id: 't', estimateMinutes: 100, actualMinutes: 200, assigneeUserId: 'u' }, 1.5)?.type).toBe('overrun');
    expect(overrun({ id: 't', estimateMinutes: null, actualMinutes: 999, assigneeUserId: 'u' }, 1.5)).toBeNull();
    expect(overrun({ id: 't', estimateMinutes: 100, actualMinutes: 120, assigneeUserId: 'u' }, 1.5)).toBeNull();
  });
  it('activity_no_session fires only for uncovered authored events', () => {
    expect(activityNoSession({ id: 'g', authorUserId: 'u', covered: false })?.type).toBe('activity_no_session');
    expect(activityNoSession({ id: 'g', authorUserId: 'u', covered: true })).toBeNull();
    expect(activityNoSession({ id: 'g', authorUserId: null, covered: false })).toBeNull();
  });
});
