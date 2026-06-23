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

// Angio rotation covering the week of 2026-08-17 (Mon) through 2026-08-23 (Sun).
const angioWeek = {
  weekStartISO: '2026-08-17T00:00:00.000Z',
  rotation: 'Angio',
  rawRotation: 'Angio',
  vacationDates: [],
};

describe('Angio → weekday Moses/Weiler advisory (soft)', () => {
  it('advises when a resident on Angio takes a weekday MOSES (feasible + angio-weekday-call)', () => {
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES, [angioWeek]);
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
    expect(evaluation.feasible).toBe(true);
    expect(isFeasibleSwap(mosesWed, bGivesAway, ctx)).toBe(true);
    const angio = evaluation.advisories?.find((a) => a.kind === 'angio-weekday-call');
    expect(angio).toBeDefined();
    if (angio && angio.kind === 'angio-weekday-call') {
      expect(angio.residentId).toBe('RES_B');
      expect(angio.shiftId).toBe('MOSES_A_0819');
      expect(angio.rotation).toBe('Angio');
    }
  });

  it('does not advise for a weekend MOSES while on Angio (Sunday is not a weekday call)', () => {
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES, [angioWeek]);
    // Sunday MOSES is within the Angio week but is a weekend day — no advisory. Sunday
    // daytime is not Shabbos-restricted (only Saturday), so the swap stays feasible.
    const mosesSun = buildShift(
      'MOSES_A_0823',
      'RES_A',
      '2026-08-23T08:00:00Z',
      '2026-08-23T20:00:00Z',
      'MOSES',
    );
    const bGivesAwaySun = buildShift(
      'MOSES_B_1122',
      'RES_B',
      '2026-11-22T08:00:00Z',
      '2026-11-22T20:00:00Z',
      'MOSES',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [mosesSun]],
        ['RES_B', [bGivesAwaySun]],
      ],
    );

    const evaluation = explainSwap(mosesSun, bGivesAwaySun, ctx);
    expect(evaluation.feasible).toBe(true);
    expect(evaluation.advisories?.some((a) => a.kind === 'angio-weekday-call') ?? false).toBe(
      false,
    );
  });

  it('does not advise for a weekday MOSES when the resident is not on Angio', () => {
    const usWeek = {
      weekStartISO: '2026-08-17T00:00:00.000Z',
      rotation: 'US',
      rawRotation: 'US',
      vacationDates: [],
    };
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES, [usWeek]);
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
    expect(evaluation.feasible).toBe(true);
    expect(evaluation.advisories?.some((a) => a.kind === 'angio-weekday-call') ?? false).toBe(
      false,
    );
  });
});
