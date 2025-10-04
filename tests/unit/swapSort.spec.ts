import { describe, expect, it } from 'vitest';

import { createSwapComparator, type SwapComparatorContext } from '@domain/swapSort';
import type { SwapCandidate, Shift } from '@domain/types';
import dayjs from '@utils/dayjs';

function buildShift(id: string, startISO: string): Shift {
  return {
    id,
    residentId: `resident-${id}`,
    startISO,
    endISO: dayjs(startISO).add(12, 'hour').toISOString(),
    type: 'MOSES',
  } as Shift;
}

function buildCandidate(
  aId: string,
  bId: string,
  startISO: string,
  overrides?: Partial<Pick<SwapCandidate, 'score'>> & {
    myScore?: number;
    counterpartScore?: number;
  },
): SwapCandidate {
  const score = overrides?.score ?? 10;
  const myScore = overrides?.myScore ?? 5;
  const counterpartScore = overrides?.counterpartScore ?? 5;
  return {
    a: buildShift(aId, startISO),
    b: buildShift(bId, startISO),
    score,
    pressure: {
      score,
      baselineScore: score,
      swappedScore: score,
      original: {
        residentId: 'resident-a',
        focusShiftId: aId,
        windowHours: 0,
        calls: [],
        baselineTotal: 0,
        swappedTotal: 0,
        deltaTotal: myScore,
      },
      counterpart: {
        residentId: 'resident-b',
        focusShiftId: bId,
        windowHours: 0,
        calls: [],
        baselineTotal: 0,
        swappedTotal: 0,
        deltaTotal: counterpartScore,
      },
    },
  } as SwapCandidate;
}

describe('createSwapComparator', () => {
  const context: SwapComparatorContext = {
    direction: 'desc',
    resolveDate: (candidate) => Date.parse(candidate.a.startISO),
  };

  it('uses both shift ids as a deterministic tie breaker for score sorting', () => {
    const first = buildCandidate('shift-a1', 'shift-b', '2025-01-01T08:00:00Z');
    const second = buildCandidate('shift-a2', 'shift-b', '2025-01-01T08:00:00Z');
    const comparator = createSwapComparator('score', context);

    expect(comparator(first, second)).toBeLessThan(0);
    expect(comparator(second, first)).toBeGreaterThan(0);
  });

  it('falls back to combined ids for date sorting ties', () => {
    const dateContext: SwapComparatorContext = {
      direction: 'asc',
      resolveDate: () => 0,
    };
    const first = buildCandidate('shift-a1', 'shift-b', '2025-01-01T08:00:00Z');
    const second = buildCandidate('shift-a1', 'shift-c', '2025-01-01T08:00:00Z');
    const comparator = createSwapComparator('date', dateContext);

    expect(comparator(first, second)).toBeLessThan(0);
    expect(comparator(second, first)).toBeGreaterThan(0);
  });
});
