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

describe('R3 call blackout — Physics Review anchor', () => {
  it('rejects swap when Physics review week would place an R3 resident on call', () => {
    // R3 resident with Physics review course rotation in April 2027
    // Academic year starting 2026-07-01 → label R3 (April 2027 falls in this AY)
    const residentR3 = buildResident(
      'R3',
      ['MOSES'],
      [
        {
          weekStartISO: '2027-04-12T00:00:00.000Z',
          rotation: 'Physics review course',
          rawRotation: 'Physics review course',
          vacationDates: [],
        },
      ],
      [
        {
          academicYearStartISO: '2026-07-01T00:00:00.000Z',
          label: 'R3',
        },
      ],
    );
    const residentB = buildResident('R4', ['MOSES']);
    // shiftA is the R3's own shift (before the blackout window, just needs to exist)
    const shiftA = buildShift('S1', 'R3', '2027-04-01T08:00:00Z', '2027-04-01T20:00:00Z', 'MOSES');
    // shiftB falls inside the blackout window: weekStart 2027-04-12, window = 2027-04-10 … 2027-04-25
    const shiftB = buildShift('S2', 'R4', '2027-04-13T08:00:00Z', '2027-04-13T20:00:00Z', 'MOSES');

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentR3, residentB],
      [
        [residentR3.id, [shiftA]],
        [residentB.id, [shiftB]],
      ],
    );

    const evaluation = explainSwap(shiftA, shiftB, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('rotation-block');
      if (evaluation.reason.kind === 'rotation-block') {
        expect(evaluation.reason.residentId).toBe('R3');
        expect(evaluation.reason.rotation).toContain('Physics review');
        expect(evaluation.reason.conflictDates).toContain('2027-04-13');
      }
    }
    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(false);
  });

  it('does NOT block an R3 resident whose rotation is MRI Course (MRI is the R2 course)', () => {
    // R3 resident with MRI Course in October — should NOT trigger rotation-block
    const residentR3 = buildResident(
      'R3',
      ['MOSES'],
      [
        {
          weekStartISO: '2026-10-05T00:00:00.000Z',
          rotation: 'MRI Course',
          rawRotation: 'MRI Course',
          vacationDates: [],
        },
      ],
      [
        {
          academicYearStartISO: '2026-07-01T00:00:00.000Z',
          label: 'R3',
        },
      ],
    );
    const residentB = buildResident('R4', ['MOSES']);
    const shiftA = buildShift('S1', 'R3', '2026-10-01T08:00:00Z', '2026-10-01T20:00:00Z', 'MOSES');
    // shiftB inside MRI Course window (weekStart 2026-10-05, window = 2026-10-03 … 2026-10-18)
    const shiftB = buildShift('S2', 'R4', '2026-10-08T08:00:00Z', '2026-10-08T20:00:00Z', 'MOSES');

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentR3, residentB],
      [
        [residentR3.id, [shiftA]],
        [residentB.id, [shiftB]],
      ],
    );

    const evaluation = explainSwap(shiftA, shiftB, ctx);
    // MRI Course must NOT cause a rotation-block rejection
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).not.toBe('rotation-block');
    } else {
      expect(evaluation.feasible).toBe(true);
    }
    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(true);
  });

  it('does NOT block a non-R3 resident whose rotation is Physics review course (blackout is R3-specific)', () => {
    // R1 resident with Physics review course — universal block removed, so NOT blocked
    const residentR1 = buildResident(
      'R1',
      ['MOSES'],
      [
        {
          weekStartISO: '2027-04-12T00:00:00.000Z',
          rotation: 'Physics review course',
          rawRotation: 'Physics review course',
          vacationDates: [],
        },
      ],
      [
        {
          academicYearStartISO: '2026-07-01T00:00:00.000Z',
          label: 'R1',
        },
      ],
    );
    const residentB = buildResident('R4', ['MOSES']);
    const shiftA = buildShift('S1', 'R1', '2027-04-01T08:00:00Z', '2027-04-01T20:00:00Z', 'MOSES');
    // shiftB inside the Physics review window
    const shiftB = buildShift('S2', 'R4', '2027-04-13T08:00:00Z', '2027-04-13T20:00:00Z', 'MOSES');

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentR1, residentB],
      [
        [residentR1.id, [shiftA]],
        [residentB.id, [shiftB]],
      ],
    );

    const evaluation = explainSwap(shiftA, shiftB, ctx);
    // Physics review must NOT block a non-R3 resident
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).not.toBe('rotation-block');
    } else {
      expect(evaluation.feasible).toBe(true);
    }
    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(true);
  });
});
