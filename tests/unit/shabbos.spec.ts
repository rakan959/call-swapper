import { describe, expect, it } from 'vitest';

import dayjs from '@utils/dayjs';
import { type Shift } from '@domain/types';
import { isFridayCall, isSaturdayDaytimeCall } from '@domain/shabbos';

function buildShift(startISO: string, type: Shift['type']): Shift {
  return {
    id: `shift-${startISO}`,
    residentId: 'resident-1',
    startISO,
    endISO: dayjs(startISO).add(12, 'hour').toISOString(),
    type,
  };
}

describe('shabbos helpers around DST', () => {
  it('treats Friday evening call as Friday during spring forward week', () => {
    const shift = buildShift('2024-03-08T18:00:00-05:00', 'MOSES');

    expect(isFridayCall(shift)).toBe(true);
  });

  it('treats Friday evening call as Friday during fall back week', () => {
    const shift = buildShift('2024-11-01T18:00:00-04:00', 'MOSES');

    expect(isFridayCall(shift)).toBe(true);
  });

  it('detects Saturday daytime call on spring forward weekend', () => {
    const shift = buildShift('2024-03-09T11:00:00-05:00', 'MOSES');

    expect(isSaturdayDaytimeCall(shift)).toBe(true);
  });

  it('detects Saturday daytime call on fall back weekend', () => {
    const shift = buildShift('2024-11-02T11:00:00-04:00', 'WEILER');

    expect(isSaturdayDaytimeCall(shift)).toBe(true);
  });
});
