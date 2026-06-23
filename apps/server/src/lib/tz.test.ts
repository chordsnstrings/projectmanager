import { describe, expect, it } from 'vitest';
import {
  addDays,
  inactiveHoursExcludingFridays,
  isFriday,
  localDateString,
  localDayRange,
  localHour,
  localToday,
  localWeekday,
  resolveTz,
  startOfLocalDay,
} from './tz';

describe('resolveTz', () => {
  it('passes valid zones through and falls back to UTC on garbage', () => {
    expect(resolveTz('Asia/Karachi')).toBe('Asia/Karachi');
    expect(resolveTz('Not/AZone')).toBe('UTC');
    expect(resolveTz(null)).toBe('UTC'); // DEFAULT_TZ is UTC in tests
  });
});

describe('localDayRange', () => {
  it('spans local midnight→midnight as UTC instants (GMT+5)', () => {
    const { start, end } = localDayRange('2026-06-23', 'Asia/Karachi'); // UTC+5, no DST
    // local midnight 2026-06-23 00:00 +05:00 === 2026-06-22T19:00:00Z
    expect(start.toISOString()).toBe('2026-06-22T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-23T19:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(24 * 3600 * 1000);
  });

  it('matches UTC exactly for UTC', () => {
    const { start, end } = localDayRange('2026-06-23', 'UTC');
    expect(start.toISOString()).toBe('2026-06-23T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-24T00:00:00.000Z');
  });
});

describe('localDateString / localHour', () => {
  it('reports the local calendar day across the UTC boundary', () => {
    // 2026-06-22T21:00:00Z is already the 23rd, 02:00, in GMT+5.
    const inst = new Date('2026-06-22T21:00:00.000Z');
    expect(localDateString(inst, 'Asia/Karachi')).toBe('2026-06-23');
    expect(localHour(inst, 'Asia/Karachi')).toBe(2);
    expect(localDateString(inst, 'UTC')).toBe('2026-06-22');
    expect(localHour(inst, 'UTC')).toBe(21);
  });
});

describe('addDays / startOfLocalDay / localToday', () => {
  it('adds calendar days correctly across month ends', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('startOfLocalDay agrees with localDayRange start', () => {
    expect(startOfLocalDay('2026-06-23', 'Asia/Karachi').toISOString()).toBe('2026-06-22T19:00:00.000Z');
  });

  it('localToday is the local date of the instant', () => {
    expect(localToday('Asia/Karachi', new Date('2026-06-22T21:00:00.000Z'))).toBe('2026-06-23');
  });
});

describe('weekday + Friday-excluded inactivity', () => {
  it('identifies Friday in UTC (2026-06-26 is a Friday)', () => {
    expect(localWeekday(new Date('2026-06-26T12:00:00Z'), 'UTC')).toBe(5);
    expect(isFriday(new Date('2026-06-26T12:00:00Z'), 'UTC')).toBe(true);
    expect(isFriday(new Date('2026-06-25T12:00:00Z'), 'UTC')).toBe(false);
  });

  it('counts raw hours when no Friday falls in the span', () => {
    // Mon 12:00 → Wed 12:00 = 48h, no Friday between
    const from = new Date('2026-06-22T12:00:00Z');
    const to = new Date('2026-06-24T12:00:00Z');
    expect(inactiveHoursExcludingFridays(from, to, 'UTC')).toBeCloseTo(48, 5);
  });

  it('discounts a Friday inside the span (48h gap → 24h effective)', () => {
    // Thu 12:00 → Sat 12:00 = 48h, but Friday (the 26th) is inside → 24h
    const from = new Date('2026-06-25T12:00:00Z');
    const to = new Date('2026-06-27T12:00:00Z');
    expect(inactiveHoursExcludingFridays(from, to, 'UTC')).toBeCloseTo(24, 5);
  });

  it('returns 0 for a non-positive span', () => {
    const t = new Date('2026-06-25T12:00:00Z');
    expect(inactiveHoursExcludingFridays(t, t, 'UTC')).toBe(0);
  });
});
