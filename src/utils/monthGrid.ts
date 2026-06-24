import dayjs from '@utils/dayjs';
import type { Shift } from '@domain/types';

export const CALENDAR_DATE_FORMAT = 'YYYY-MM-DD';

/**
 * Builds a Sunday-first month matrix of `YYYY-MM-DD` date strings.
 *
 * The number of weeks is dynamic (5 or 6) so the grid spans exactly from the
 * Sunday on/before the 1st through the Saturday on/after the last day of the
 * month — matching the reference design rather than a fixed six-week grid.
 *
 * Dates are sequenced in UTC purely as calendar days, which sidesteps DST
 * transitions that would otherwise duplicate or skip a day when advancing.
 *
 * @param anchor Any `YYYY-MM` or `YYYY-MM-DD` string within the target month.
 */
export function buildMonthMatrix(anchor: string): string[][] {
  const monthStart = dayjs.utc(anchor).startOf('month');
  const monthEnd = dayjs.utc(anchor).endOf('month');
  const gridStart = monthStart.subtract(monthStart.day(), 'day');
  const gridEnd = monthEnd.add(6 - monthEnd.day(), 'day');

  const weeks: string[][] = [];
  let cursor = gridStart;
  while (cursor.isBefore(gridEnd) || cursor.isSame(gridEnd, 'day')) {
    const week: string[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      week.push(cursor.format(CALENDAR_DATE_FORMAT));
      cursor = cursor.add(1, 'day');
    }
    weeks.push(week);
  }
  return weeks;
}

/**
 * Resolves the calendar day a shift falls on, in the app's configured
 * timezone, so placement is stable regardless of the host machine's clock.
 */
export function shiftDayKey(startISO: string): string {
  return dayjs(startISO).tz().format(CALENDAR_DATE_FORMAT);
}

/**
 * Groups shifts by their `YYYY-MM-DD` calendar day (configured timezone).
 * Insertion order within each day is preserved.
 */
export function groupShiftsByDay(shifts: readonly Shift[]): Map<string, Shift[]> {
  const byDay = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const key = shiftDayKey(shift.startISO);
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.push(shift);
    } else {
      byDay.set(key, [shift]);
    }
  }
  return byDay;
}

/**
 * Maps a Sunday-first week row to the `YYYY-MM-DD` of the Monday it contains,
 * which is the key used by the rotation schedule (rotations are anchored to the
 * Monday of each week). UTC parsing mirrors how rotation assignments are keyed
 * upstream, keeping the rotation column aligned with the day grid.
 */
export function rotationWeekKey(rowDates: readonly string[]): string | null {
  const first = rowDates[0];
  if (!first) {
    return null;
  }
  let monday = dayjs.utc(first);
  if (!monday.isValid()) {
    return null;
  }
  const dayOfWeek = monday.day();
  if (dayOfWeek === 0) {
    monday = monday.add(1, 'day');
  } else if (dayOfWeek > 1) {
    monday = monday.subtract(dayOfWeek - 1, 'day');
  }
  return monday.format(CALENDAR_DATE_FORMAT);
}
