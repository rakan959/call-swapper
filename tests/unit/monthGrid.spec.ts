import { describe, expect, it } from 'vitest';
import {
  buildMonthMatrix,
  groupShiftsByDay,
  rotationWeekKey,
  shiftDayKey,
} from '../../src/utils/monthGrid';
import type { Shift } from '../../src/domain/types';

function makeShift(id: string, startISO: string, type: Shift['type'] = 'MOSES'): Shift {
  return {
    id,
    residentId: 'r1',
    startISO,
    endISO: startISO,
    type,
  };
}

describe('buildMonthMatrix', () => {
  it('spans Sunday-before-1st through Saturday-after-last for a 5-week month', () => {
    // December 2026: Dec 1 is a Tuesday, Dec 31 is a Thursday → 5 weeks.
    const weeks = buildMonthMatrix('2026-12-01');
    expect(weeks).toHaveLength(5);
    weeks.forEach((week) => expect(week).toHaveLength(7));
    expect(weeks[0]?.[0]).toBe('2026-11-29'); // leading Sunday
    expect(weeks[0]?.[2]).toBe('2026-12-01'); // Tuesday
    expect(weeks[4]?.[6]).toBe('2027-01-02'); // trailing Saturday
    expect(weeks.flat()).toContain('2026-12-31');
  });

  it('produces 6 weeks when the month overflows the grid', () => {
    // August 2026: Aug 1 is a Saturday, Aug 31 is a Monday → 6 weeks.
    const weeks = buildMonthMatrix('2026-08-15');
    expect(weeks).toHaveLength(6);
    expect(weeks[0]?.[0]).toBe('2026-07-26');
    expect(weeks[5]?.[6]).toBe('2026-09-05');
  });

  it('accepts a YYYY-MM anchor and starts every row on Sunday', () => {
    const weeks = buildMonthMatrix('2026-12');
    expect(weeks[0]?.[0]).toBe('2026-11-29');
    weeks.forEach((week) => {
      // First column is always a Sunday.
      const dow = new Date(`${week[0]}T00:00:00Z`).getUTCDay();
      expect(dow).toBe(0);
    });
  });

  it('handles a leap-year February correctly', () => {
    // Feb 2028 is a leap year (29 days); Feb 1 2028 is a Tuesday.
    const weeks = buildMonthMatrix('2028-02');
    expect(weeks.flat()).toContain('2028-02-29');
    expect(weeks.flat()).not.toContain('2028-02-30');
  });
});

describe('shiftDayKey / groupShiftsByDay', () => {
  it('keys a shift by its day in the configured (New York) timezone', () => {
    // 02:00 UTC on the 19th is 21:00 on the 18th in New York.
    expect(shiftDayKey('2026-12-19T02:00:00Z')).toBe('2026-12-18');
    // An explicit NY offset stays on its own day.
    expect(shiftDayKey('2026-12-18T08:00:00-05:00')).toBe('2026-12-18');
  });

  it('groups multiple shifts on the same day and preserves order', () => {
    const shifts = [
      makeShift('a', '2026-12-18T08:00:00-05:00'),
      makeShift('b', '2026-12-18T20:00:00-05:00', 'WEILER'),
      makeShift('c', '2026-12-19T08:00:00-05:00'),
    ];
    const byDay = groupShiftsByDay(shifts);
    expect(byDay.get('2026-12-18')?.map((s) => s.id)).toEqual(['a', 'b']);
    expect(byDay.get('2026-12-19')?.map((s) => s.id)).toEqual(['c']);
  });
});

describe('rotationWeekKey', () => {
  it('returns the Monday of a Sunday-first week row', () => {
    expect(rotationWeekKey(['2026-12-13', '2026-12-14', '2026-12-15'])).toBe('2026-12-14');
  });

  it('returns null for an empty row', () => {
    expect(rotationWeekKey([])).toBeNull();
  });
});
