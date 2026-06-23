import { describe, it, expect } from 'vitest';
import { isFeasibleSwap, explainSwap } from '../../src/domain/rules';
import type { Context, Resident, RuleConfig, Shift } from '../../src/domain/types';
import { resolveShabbosObservers } from '../../src/domain/shabbos';

const baseRuleConfig: RuleConfig = {
  restHoursMin: 10,
  typeWhitelist: ['MOSES', 'WEILER', 'IP CONSULT', 'NIGHT FLOAT', 'BACKUP'],
};
const ALL_TYPES: Shift['type'][] = ['MOSES', 'WEILER', 'IP CONSULT', 'NIGHT FLOAT', 'BACKUP'];

function buildResident(id: string, eligibleTypes: Shift['type'][]): Resident {
  return { id, name: id, eligibleShiftTypes: eligibleTypes, rotations: [], academicYears: [] };
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

// 2026-08-17 Mon, 08-18 Tue, 08-20 Thu, 08-22 Sat, 08-23 Sun, 11-21 Sat, 12-01 Tue.
describe('Adjacency advisories (soft, never reject)', () => {
  it('flags consecutive same-type calls on adjacent days (feasible + consecutive-call)', () => {
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES);
    const mosesTue = buildShift(
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
    const mosesMon = buildShift(
      'MOSES_B_0817',
      'RES_B',
      '2026-08-17T08:00:00Z',
      '2026-08-17T20:00:00Z',
      'MOSES',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [mosesTue]],
        ['RES_B', [bGivesAway, mosesMon]],
      ],
    );

    const evaluation = explainSwap(mosesTue, bGivesAway, ctx);
    expect(evaluation.feasible).toBe(true);
    expect(isFeasibleSwap(mosesTue, bGivesAway, ctx)).toBe(true);
    const consecutive = evaluation.advisories?.find((a) => a.kind === 'consecutive-call');
    expect(consecutive).toBeDefined();
    if (consecutive && consecutive.kind === 'consecutive-call') {
      expect(consecutive.residentId).toBe('RES_B');
      expect(consecutive.shiftId).toBe('MOSES_A_0818');
      expect(consecutive.adjacentShiftId).toBe('MOSES_B_0817');
      expect(consecutive.callType).toBe('MOSES');
    }
    // Not a weekend pair → no both-weekend advisory.
    expect(evaluation.advisories?.some((a) => a.kind === 'both-weekend') ?? false).toBe(false);
  });

  it('flags calls on both weekend days (feasible + both-weekend, distinct from consecutive-call)', () => {
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES);
    // Both swapped shifts are Saturday IP CONSULT: passes weekend-mismatch, and IP
    // CONSULT is not a Saturday *daytime* MOSES/WEILER, so no Shabbos restriction.
    const ipSatA = buildShift(
      'IP_A_0822',
      'RES_A',
      '2026-08-22T08:00:00Z',
      '2026-08-22T20:00:00Z',
      'IP CONSULT',
    );
    const ipSatBFar = buildShift(
      'IP_B_1121',
      'RES_B',
      '2026-11-21T08:00:00Z',
      '2026-11-21T20:00:00Z',
      'IP CONSULT',
    );
    // Existing Sunday WEILER (different type → not consecutive-call, only both-weekend).
    const weilerSun = buildShift(
      'WEILER_B_0823',
      'RES_B',
      '2026-08-23T08:00:00Z',
      '2026-08-23T20:00:00Z',
      'WEILER',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [ipSatA]],
        ['RES_B', [ipSatBFar, weilerSun]],
      ],
    );

    const evaluation = explainSwap(ipSatA, ipSatBFar, ctx);
    expect(evaluation.feasible).toBe(true);
    expect(isFeasibleSwap(ipSatA, ipSatBFar, ctx)).toBe(true);
    const bothWeekend = evaluation.advisories?.find((a) => a.kind === 'both-weekend');
    expect(bothWeekend).toBeDefined();
    if (bothWeekend && bothWeekend.kind === 'both-weekend') {
      expect(bothWeekend.residentId).toBe('RES_B');
      expect(bothWeekend.shiftId).toBe('IP_A_0822');
      expect(bothWeekend.otherShiftId).toBe('WEILER_B_0823');
    }
    // Different types across the weekend → no consecutive-call advisory.
    expect(evaluation.advisories?.some((a) => a.kind === 'consecutive-call') ?? false).toBe(false);
  });

  it('does not flag calls two days apart (no adjacency advisory)', () => {
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES);
    const mosesTue = buildShift(
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
    // Existing MOSES two days from the incoming (Thu vs Tue) → no consecutive, no weekend.
    const mosesThu = buildShift(
      'MOSES_B_0820',
      'RES_B',
      '2026-08-20T08:00:00Z',
      '2026-08-20T20:00:00Z',
      'MOSES',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [mosesTue]],
        ['RES_B', [bGivesAway, mosesThu]],
      ],
    );

    const evaluation = explainSwap(mosesTue, bGivesAway, ctx);
    expect(evaluation.feasible).toBe(true);
    expect(
      evaluation.advisories?.some(
        (a) => a.kind === 'consecutive-call' || a.kind === 'both-weekend',
      ) ?? false,
    ).toBe(false);
  });

  it('fires BOTH advisories for a same-type Saturday+Sunday pair (independent signals)', () => {
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES);
    // Saturday IP CONSULT swapped for a far Saturday IP CONSULT (passes weekend-match,
    // dodges Shabbos), with an existing Sunday IP CONSULT of the SAME type.
    const ipSatA = buildShift(
      'IP_A_0822',
      'RES_A',
      '2026-08-22T08:00:00Z',
      '2026-08-22T20:00:00Z',
      'IP CONSULT',
    );
    const ipSatBFar = buildShift(
      'IP_B_1121',
      'RES_B',
      '2026-11-21T08:00:00Z',
      '2026-11-21T20:00:00Z',
      'IP CONSULT',
    );
    const ipSun = buildShift(
      'IP_B_0823',
      'RES_B',
      '2026-08-23T08:00:00Z',
      '2026-08-23T20:00:00Z',
      'IP CONSULT',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [ipSatA]],
        ['RES_B', [ipSatBFar, ipSun]],
      ],
    );

    const evaluation = explainSwap(ipSatA, ipSatBFar, ctx);
    expect(evaluation.feasible).toBe(true);
    expect(evaluation.advisories?.some((a) => a.kind === 'consecutive-call') ?? false).toBe(true);
    expect(evaluation.advisories?.some((a) => a.kind === 'both-weekend') ?? false).toBe(true);
  });

  it('excludes BACKUP from adjacency: an existing adjacent BACKUP yields no advisory', () => {
    const residentA = buildResident('RES_A', ALL_TYPES);
    const residentB = buildResident('RES_B', ALL_TYPES);
    const mosesTue = buildShift(
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
    // Existing BACKUP the day before the incoming MOSES — must be ignored by adjacency.
    const backupMon = buildShift(
      'BACKUP_B_0817',
      'RES_B',
      '2026-08-17T08:00:00Z',
      '2026-08-17T20:00:00Z',
      'BACKUP',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        ['RES_A', [mosesTue]],
        ['RES_B', [bGivesAway, backupMon]],
      ],
    );

    const evaluation = explainSwap(mosesTue, bGivesAway, ctx);
    expect(evaluation.feasible).toBe(true);
    expect(
      evaluation.advisories?.some(
        (a) => a.kind === 'consecutive-call' || a.kind === 'both-weekend',
      ) ?? false,
    ).toBe(false);
  });
});
