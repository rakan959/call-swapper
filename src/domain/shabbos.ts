import dayjs from '@utils/dayjs';
import type { Shift } from './types';

const FRIDAY = 5;
const SATURDAY = 6;
const SATURDAY_DAYTIME_TYPES = new Set<Shift['type']>(['MOSES', 'WEILER']);

export type ShabbosRestriction =
  | 'observer-friday-call'
  | 'observer-saturday-daytime'
  | 'observer-night-float'
  | 'nonobserver-night-float';

export function isFridayCall(shift: Shift): boolean {
  const start = dayjs(shift.startISO);
  if (!start.isValid()) {
    return false;
  }
  return start.day() === FRIDAY;
}

export function isNightFloat(shift: Shift): boolean {
  return shift.type === 'NIGHT FLOAT';
}

export function isSaturdayNightFloat(shift: Shift): boolean {
  if (!isNightFloat(shift)) {
    return false;
  }
  const start = dayjs(shift.startISO);
  return start.isValid() && start.day() === SATURDAY;
}

export function isSaturdayDaytimeCall(shift: Shift): boolean {
  if (!SATURDAY_DAYTIME_TYPES.has(shift.type)) {
    return false;
  }
  const start = dayjs(shift.startISO);
  if (!start.isValid()) {
    return false;
  }
  if (start.day() !== SATURDAY) {
    return false;
  }
  // Weekend daytime Moses/Weiler calls start during the morning or early afternoon
  return start.hour() < 17;
}

export function resolveShabbosObservers(
  shiftsByResident: ReadonlyMap<string, readonly Shift[]>,
): ReadonlySet<string> {
  const observers = new Set<string>();
  for (const [residentId, shifts] of shiftsByResident) {
    const hasSaturdayDaytimeCall = (shifts ?? []).some(isSaturdayDaytimeCall);
    if (!hasSaturdayDaytimeCall) {
      observers.add(residentId);
    }
  }
  return observers;
}
