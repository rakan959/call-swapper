import { describe, it, expect } from 'vitest';
import { isFeasibleSwap, explainSwap } from '../../src/domain/rules';
import type { Context, Resident, RuleConfig, Shift } from '../../src/domain/types';
import { resolveShabbosObservers } from '../../src/domain/shabbos';

const baseRuleConfig: RuleConfig = {
  restHoursMin: 10,
  typeWhitelist: ['MOSES', 'WEILER', 'IP CONSULT', 'NIGHT FLOAT', 'BACKUP'],
};
const ALL_TYPES: Shift['type'][] = ['MOSES', 'WEILER', 'IP CONSULT', 'NIGHT FLOAT', 'BACKUP'];

function buildResident(
  id: string,
  eligibleTypes: Shift['type'][],
  rotations: Resident['rotations'] = [],
): Resident {
  return { id, name: id, eligibleShiftTypes: eligibleTypes, rotations, academicYears: [] };
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

// AIRP rotation for the week of 2026-08-17 (Mon). AIRP is a full-week call block
// (in CALL_BLOCK_ROTATION_PATTERNS) — this regression pins that it stays a WHOLE-week
// block (no weekday-only relaxation) once the surname name-join re-attaches rotations.
const airpWeek = {
  weekStartISO: '2026-08-17T00:00:00.000Z',
  rotation: 'AIRP',
  rawRotation: 'AIRP',
  vacationDates: [],
};

describe('AIRP full-week block (regression)', () => {
  it('rejects a WEEKDAY call swapped onto a resident on AIRP that week', () => {
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES, [airpWeek]);
    const mosesWed = buildShift(
      'MOSES_A_0819',
      'RES_A',
      '2026-08-19T08:00:00Z',
      '2026-08-19T20:00:00Z',
      'MOSES',
    );
    const bGivesAway = buildShift(
      'MOSES_B_1201',
      'RES_B',
      '2026-12-01T08:00:00Z',
      '2026-12-01T20:00:00Z',
      'MOSES',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [mosesWed]],
        ['RES_B', [bGivesAway]],
      ],
    );

    const evaluation = explainSwap(mosesWed, bGivesAway, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('rotation-block');
      if (evaluation.reason.kind === 'rotation-block') {
        expect(evaluation.reason.residentId).toBe('RES_B');
        expect(evaluation.reason.rotation).toContain('AIRP');
      }
    }
    expect(isFeasibleSwap(mosesWed, bGivesAway, ctx)).toBe(false);
  });

  it('rejects a WEEKEND call swapped onto a resident on AIRP that week', () => {
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES, [airpWeek]);
    // Saturday 2026-08-22 is inside the AIRP block window (robust in both UTC and
    // local time). Use IP CONSULT so the day is a weekend call that is NOT
    // Shabbos-restricted (only Saturday daytime MOSES/WEILER are) — the rotation
    // block is therefore what rejects it. AIRP is not an IP-consult-banned rotation,
    // so ip-consult-rotation-ban does not pre-empt the rotation-block.
    const ipSat = buildShift(
      'IP_A_0822',
      'RES_A',
      '2026-08-22T08:00:00Z',
      '2026-08-22T20:00:00Z',
      'IP CONSULT',
    );
    const bGivesAwaySat = buildShift(
      'IP_B_1121',
      'RES_B',
      '2026-11-21T08:00:00Z',
      '2026-11-21T20:00:00Z',
      'IP CONSULT',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [ipSat]],
        ['RES_B', [bGivesAwaySat]],
      ],
    );

    const evaluation = explainSwap(ipSat, bGivesAwaySat, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('rotation-block');
      if (evaluation.reason.kind === 'rotation-block') {
        expect(evaluation.reason.rotation).toContain('AIRP');
      }
    }
    expect(isFeasibleSwap(ipSat, bGivesAwaySat, ctx)).toBe(false);
  });
});
