import { describe, it, expect } from 'vitest';
import { isFeasibleSwap, explainSwap } from '../../src/domain/rules';
import type { Context, Resident, RuleConfig, Shift } from '../../src/domain/types';
import { resolveShabbosObservers } from '../../src/domain/shabbos';

const baseRuleConfig: RuleConfig = {
  restHoursMin: 10,
  typeWhitelist: ['MOSES', 'WEILER', 'IP CONSULT', 'NIGHT FLOAT', 'BACKUP'],
};

function buildResident(
  id: string,
  eligibleTypes: Shift['type'][],
  rotations: Resident['rotations'] = [],
  academicYears: Resident['academicYears'] = [],
): Resident {
  return { id, name: id, eligibleShiftTypes: eligibleTypes, rotations, academicYears };
}

function buildShift(
  id: string,
  residentId: string,
  startISO: string,
  endISO: string,
  type: Shift['type'],
): Shift {
  return { id, residentId, startISO, endISO, type };
}

function buildContextWithShifts(
  config: RuleConfig,
  residents: Resident[],
  shiftEntries: Array<[string, Shift[]]>,
): Context {
  const residentsById = new Map(residents.map((resident) => [resident.id, resident]));
  const shiftsByResident = new Map<string, Shift[]>(
    shiftEntries.map(([id, shifts]) => [
      id,
      [...shifts].sort((a, b) => a.startISO.localeCompare(b.startISO)),
    ]),
  );
  return {
    ruleConfig: config,
    residentsById,
    shiftsByResident,
    shabbosObservers: resolveShabbosObservers(shiftsByResident),
  };
}

describe('NF 2-day buffer for true calls', () => {
  // Dates: 2026-09-15 (Tue) = NF shift for residentB
  //        2026-09-16 (Wed) = MOSES received by residentB — gap 1 → reject
  //        2026-09-17 (Thu) = MOSES received by residentB — gap 2 → allow
  // residentA owns shiftA (MOSES on 2026-09-16 or 09-17) and swaps it to residentB.
  // residentB owns shiftB (MOSES on 2026-12-01, far away — the shift B gives away)
  //   plus an NF shift on 2026-09-15 that stays in B's timeline.

  const residentA = buildResident('RES_A', [
    'MOSES',
    'NIGHT FLOAT',
    'WEILER',
    'IP CONSULT',
    'BACKUP',
  ]);
  const residentB = buildResident('RES_B', [
    'MOSES',
    'NIGHT FLOAT',
    'WEILER',
    'IP CONSULT',
    'BACKUP',
  ]);

  // The NF shift residentB already has (stays in their timeline after the swap)
  const nfShift = buildShift(
    'NF_B_0915',
    'RES_B',
    '2026-09-15T19:00:00Z', // Tue 2026-09-15 19:00 UTC (NF typically evening start)
    '2026-09-16T07:00:00Z',
    'NIGHT FLOAT',
  );

  // The shift residentB gives away in both test cases (far-future date, no interference)
  const shiftBGivesAway = buildShift(
    'MOSES_B_1201',
    'RES_B',
    '2026-12-01T08:00:00Z',
    '2026-12-01T20:00:00Z',
    'MOSES',
  );

  it('gap 1 → rejects with nf-buffer (MOSES on 2026-09-16, NF on 2026-09-15)', () => {
    // residentA gives away: MOSES on 2026-09-16 (gap 1 from NF 2026-09-15)
    // residentA also has a far-future shift so the swap is not nonsensical
    const shiftA = buildShift(
      'MOSES_A_0916',
      'RES_A',
      '2026-09-16T08:00:00Z',
      '2026-09-16T20:00:00Z',
      'MOSES',
    );

    // residentA's own far-date shift to give away something from residentB
    // We need residentA to hold shiftBGivesAway as well... actually in evaluateSwap,
    // shiftA is what A gives away and shiftB is what B gives away.
    // So: residentA gives shiftA (MOSES 09-16), residentB gives shiftBGivesAway (MOSES 12-01).
    // After swap: residentB receives shiftA (MOSES 09-16) → gap 1 from NF on 09-15 → reject.

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [shiftA]],
        // residentB has shiftBGivesAway (what they give up) AND nfShift (stays in their timeline)
        ['RES_B', [shiftBGivesAway, nfShift]],
      ],
    );

    const evaluation = explainSwap(shiftA, shiftBGivesAway, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('nf-buffer');
      if (evaluation.reason.kind === 'nf-buffer') {
        expect(evaluation.reason.residentId).toBe('RES_B');
        expect(evaluation.reason.gapDays).toBe(1);
        expect(evaluation.reason.nfShiftId).toBe('NF_B_0915');
        expect(evaluation.reason.shiftId).toBe('MOSES_A_0916');
      }
    }
    expect(isFeasibleSwap(shiftA, shiftBGivesAway, ctx)).toBe(false);
  });

  it('gap 2 → allows (MOSES on 2026-09-17, NF on 2026-09-15)', () => {
    // residentA gives away: MOSES on 2026-09-17 (gap 2 from NF 2026-09-15) → allow
    const shiftA2 = buildShift(
      'MOSES_A_0917',
      'RES_A',
      '2026-09-17T08:00:00Z',
      '2026-09-17T20:00:00Z',
      'MOSES',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [shiftA2]],
        ['RES_B', [shiftBGivesAway, nfShift]],
      ],
    );

    expect(isFeasibleSwap(shiftA2, shiftBGivesAway, ctx)).toBe(true);
  });
});
