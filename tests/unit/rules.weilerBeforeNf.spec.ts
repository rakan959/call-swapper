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

// All dates are weekdays to avoid weekend/Shabbos interaction:
//   2026-08-18 Tue, 2026-08-19 Wed, 2026-08-20 Thu, 2026-12-01 Tue.
const ALL_TYPES: Shift['type'][] = ['MOSES', 'WEILER', 'IP CONSULT', 'NIGHT FLOAT', 'BACKUP'];

describe('Weiler-before-NF (hard reject)', () => {
  it('rejects when an incoming WEILER lands the day before an existing NF (weiler-before-nf preempts nf-buffer)', () => {
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES);
    // residentA gives away a WEILER on 2026-08-18
    const weilerA = buildShift(
      'WEILER_A_0818',
      'RES_A',
      '2026-08-18T08:00:00Z',
      '2026-08-18T20:00:00Z',
      'WEILER',
    );
    // residentB gives away a far-future MOSES, and keeps an NF on 2026-08-19 (day after the Weiler)
    const bGivesAway = buildShift(
      'MOSES_B_1201',
      'RES_B',
      '2026-12-01T08:00:00Z',
      '2026-12-01T20:00:00Z',
      'MOSES',
    );
    const nfB = buildShift(
      'NF_B_0819',
      'RES_B',
      '2026-08-19T19:00:00Z',
      '2026-08-20T07:00:00Z',
      'NIGHT FLOAT',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [weilerA]],
        ['RES_B', [bGivesAway, nfB]],
      ],
    );

    const evaluation = explainSwap(weilerA, bGivesAway, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('weiler-before-nf');
      if (evaluation.reason.kind === 'weiler-before-nf') {
        expect(evaluation.reason.residentId).toBe('RES_B');
        expect(evaluation.reason.shiftId).toBe('WEILER_A_0818');
        expect(evaluation.reason.nfShiftId).toBe('NF_B_0819');
      }
    }
    expect(isFeasibleSwap(weilerA, bGivesAway, ctx)).toBe(false);
  });

  it('is WEILER-specific: an incoming MOSES the day before NF is nf-buffer, not weiler-before-nf', () => {
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES);
    // residentA gives away a MOSES on 2026-08-18 (a true call, but not WEILER)
    const mosesA = buildShift(
      'MOSES_A_0818',
      'RES_A',
      '2026-08-18T08:00:00Z',
      '2026-08-18T20:00:00Z',
      'MOSES',
    );
    const bGivesAway = buildShift(
      'MOSES_B_1201',
      'RES_B',
      '2026-12-01T08:00:00Z',
      '2026-12-01T20:00:00Z',
      'MOSES',
    );
    const nfB = buildShift(
      'NF_B_0819',
      'RES_B',
      '2026-08-19T19:00:00Z',
      '2026-08-20T07:00:00Z',
      'NIGHT FLOAT',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [mosesA]],
        ['RES_B', [bGivesAway, nfB]],
      ],
    );

    // residentB receives the MOSES the day before its NF: caught by the NF 2-day
    // buffer (true-call rule), NOT by weiler-before-nf, which is Weiler-specific.
    const evaluation = explainSwap(mosesA, bGivesAway, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('nf-buffer');
    }
    expect(isFeasibleSwap(mosesA, bGivesAway, ctx)).toBe(false);
  });

  it('allows when a WEILER is two days before NF (not immediately before)', () => {
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES);
    const weilerA = buildShift(
      'WEILER_A_0818',
      'RES_A',
      '2026-08-18T08:00:00Z',
      '2026-08-18T20:00:00Z',
      'WEILER',
    );
    const bGivesAway = buildShift(
      'MOSES_B_1201',
      'RES_B',
      '2026-12-01T08:00:00Z',
      '2026-12-01T20:00:00Z',
      'MOSES',
    );
    // NF two days after the Weiler (2026-08-20) — gap 2 → neither weiler-before-nf nor nf-buffer fires
    const nfB = buildShift(
      'NF_B_0820',
      'RES_B',
      '2026-08-20T19:00:00Z',
      '2026-08-21T07:00:00Z',
      'NIGHT FLOAT',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [weilerA]],
        ['RES_B', [bGivesAway, nfB]],
      ],
    );

    expect(isFeasibleSwap(weilerA, bGivesAway, ctx)).toBe(true);
  });
});
