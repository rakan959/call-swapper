import dayjs from '@utils/dayjs';
import type { Shift } from './types';

const WEEKEND_DAYS = new Set([0, 6]);
const WINDOW_DAYS = 7;

export function isWeekend(iso: string): boolean {
  const day = dayjs(iso).day();
  return WEEKEND_DAYS.has(day);
}

export function isWeekendOrHoliday(shift: Shift): boolean {
  if (shift.isHoliday) {
    return true;
  }
  return isWeekend(shift.startISO) || isWeekend(shift.endISO);
}

export const REST_WINDOW_HOURS = WINDOW_DAYS * 24;
