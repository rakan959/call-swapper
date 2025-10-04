/**
 * @req: F-009
 * @req: F-011
 */
import { describe, expect, it } from 'vitest';
import { calculateSwapPressure, proximityPressure } from '@domain/simipar';
import { resolveShabbosObservers } from '@domain/shabbos';
import type { Context, Resident, RotationAssignment, RuleConfig, Shift } from '@domain/types';

const fullWhitelist: Shift['type'][] = ['MOSES', 'WEILER', 'IP CONSULT', 'NIGHT FLOAT', 'BACKUP'];

function buildResident(
  id: string,
  eligibleShiftTypes: Shift['type'][],
  rotations: RotationAssignment[] = [],
  academicYears: Resident['academicYears'] = [],
): Resident {
  return {
    id,
    name: id,
    eligibleShiftTypes,
    rotations,
    academicYears,
  };
}

function buildShift(
  id: string,
  residentId: string,
  startISO: string,
  endISO: string,
  type: Shift['type'],
  location?: string,
): Shift {
  return {
    id,
    residentId,
    startISO,
    endISO,
    type,
    location,
  };
}

function buildContext(
  residents: readonly Resident[],
  timelines: Record<string, Shift[]>,
  overrides: Partial<RuleConfig> = {},
): Context {
  const baseConfig: RuleConfig = {
    restHoursMin: 10,
    typeWhitelist: fullWhitelist,
  };
  const cfg: RuleConfig = {
    ...baseConfig,
    ...overrides,
    typeWhitelist: overrides.typeWhitelist ?? baseConfig.typeWhitelist,
  };

  const residentsById = new Map(residents.map((resident) => [resident.id, resident]));
  const shiftsByResident = new Map<string, Shift[]>();
  residents.forEach((resident) => {
    const shifts = timelines[resident.id] ?? [];
    shiftsByResident.set(
      resident.id,
      [...shifts].sort((a, b) => a.startISO.localeCompare(b.startISO)),
    );
  });

  return {
    ruleConfig: cfg,
    residentsById,
    shiftsByResident,
    shabbosObservers: resolveShabbosObservers(shiftsByResident),
  };
}

describe('proximityPressure', () => {
  it('returns zero when swap fails eligibility', () => {
    const residentA = buildResident('R1', ['MOSES']);
    const residentB = buildResident('R2', ['WEILER']);
    const shiftA = buildShift('SA', 'R1', '2025-10-05T08:00:00Z', '2025-10-05T18:00:00Z', 'MOSES');
    const shiftB = buildShift('SB', 'R2', '2025-10-06T08:00:00Z', '2025-10-06T18:00:00Z', 'WEILER');
    const ctx = buildContext([residentA, residentB], {
      R1: [shiftA],
      R2: [shiftB],
    });

    expect(proximityPressure(shiftA, shiftB, ctx)).toBe(0);
  });

  it('produces a positive score when the swap increases rest margins', () => {
    const residentA = buildResident('R1', ['MOSES', 'WEILER']);
    const residentB = buildResident('R2', ['MOSES', 'WEILER']);

    const priorA = buildShift(
      'SA_prev',
      'R1',
      '2025-09-30T20:00:00Z',
      '2025-10-01T00:00:00Z',
      'MOSES',
    );
    const shiftA = buildShift('SA', 'R1', '2025-10-01T08:00:00Z', '2025-10-01T18:00:00Z', 'MOSES');

    const shiftB = buildShift('SB', 'R2', '2025-10-03T08:00:00Z', '2025-10-03T18:00:00Z', 'WEILER');
    const followUpB = buildShift(
      'SB_next',
      'R2',
      '2025-10-05T08:00:00Z',
      '2025-10-05T18:00:00Z',
      'MOSES',
    );

    const ctx = buildContext(
      [residentA, residentB],
      {
        R1: [priorA, shiftA],
        R2: [shiftB, followUpB],
      },
      { restHoursMin: 0 },
    );

    const score = proximityPressure(shiftA, shiftB, ctx);
    expect(score).toBeGreaterThan(0);
  });

  it('produces a negative score when the swap reduces rest margins', () => {
    const residentA = buildResident('R1', ['MOSES', 'WEILER']);
    const residentB = buildResident('R2', ['MOSES', 'WEILER']);

    const priorA = buildShift(
      'SA_prev',
      'R1',
      '2025-09-30T20:00:00Z',
      '2025-10-01T00:00:00Z',
      'MOSES',
    );
    const shiftA = buildShift('SA', 'R1', '2025-10-03T08:00:00Z', '2025-10-03T18:00:00Z', 'WEILER');

    const shiftB = buildShift('SB', 'R2', '2025-10-01T08:00:00Z', '2025-10-01T18:00:00Z', 'MOSES');
    const followUpB = buildShift(
      'SB_next',
      'R2',
      '2025-10-02T22:00:00Z',
      '2025-10-03T06:00:00Z',
      'MOSES',
    );

    const ctx = buildContext(
      [residentA, residentB],
      {
        R1: [priorA, shiftA],
        R2: [shiftB, followUpB],
      },
      { restHoursMin: 0 },
    );

    const score = proximityPressure(shiftA, shiftB, ctx);
    expect(score).toBeLessThan(0);
  });
});

describe('calculateSwapPressure', () => {
  it('only includes calls within four-day window for the breakdown', () => {
    const residentA = buildResident('R1', ['MOSES']);
    const residentB = buildResident('R2', ['MOSES']);

    const nearbyShift = buildShift(
      'SA_prev',
      'R1',
      '2025-09-29T08:00:00Z',
      '2025-09-29T18:00:00Z',
      'MOSES',
    );
    const distantShift = buildShift(
      'SA_far',
      'R1',
      '2025-10-10T08:00:00Z',
      '2025-10-10T18:00:00Z',
      'MOSES',
    );
    const primaryShift = buildShift(
      'SA',
      'R1',
      '2025-10-01T08:00:00Z',
      '2025-10-01T18:00:00Z',
      'MOSES',
    );
    const counterpartShift = buildShift(
      'SB',
      'R2',
      '2025-10-03T08:00:00Z',
      '2025-10-03T18:00:00Z',
      'MOSES',
    );

    const ctx = buildContext([residentA, residentB], {
      R1: [nearbyShift, distantShift, primaryShift],
      R2: [counterpartShift],
    });

    const breakdown = calculateSwapPressure(primaryShift, counterpartShift, ctx);

    expect(breakdown.original.windowHours).toBe(96);
    const callIds = breakdown.original.calls.map((call) => call.shiftId);
    expect(callIds).toContain('SA_prev');
    expect(callIds).not.toContain('SA_far');
  });

  it('provides component contributions that sum to the delta score', () => {
    const residentA = buildResident('R1', ['MOSES']);
    const residentB = buildResident('R2', ['MOSES']);
    const shiftA = buildShift('SA', 'R1', '2025-10-01T08:00:00Z', '2025-10-01T18:00:00Z', 'MOSES');
    const shiftB = buildShift('SB', 'R2', '2025-10-04T08:00:00Z', '2025-10-04T18:00:00Z', 'MOSES');
    const ctx = buildContext([residentA, residentB], {
      R1: [shiftA],
      R2: [shiftB],
    });

    const breakdown = calculateSwapPressure(shiftA, shiftB, ctx);
    const delta = proximityPressure(shiftA, shiftB, ctx);

    const contributionSum = [...breakdown.original.calls, ...breakdown.counterpart.calls].reduce(
      (sum, call) => sum + call.delta,
      0,
    );

    expect(breakdown.swappedScore).toBeCloseTo(breakdown.baselineScore + delta, 6);
    expect(breakdown.score).toBeCloseTo(delta, 6);
    expect(contributionSum).toBeCloseTo(delta, 6);
    expect(breakdown.original.residentId).toBe('R1');
    expect(breakdown.counterpart.residentId).toBe('R2');
    expect(breakdown.original.deltaTotal + breakdown.counterpart.deltaTotal).toBeCloseTo(delta, 6);
  });

  it('returns zero-valued breakdown for invalid swaps', () => {
    const resident = buildResident('R1', ['MOSES']);
    const shift = buildShift('SA', 'R1', '2025-10-01T08:00:00Z', '2025-10-01T18:00:00Z', 'MOSES');
    const ctx = buildContext([resident], {
      R1: [shift],
    });

    const breakdown = calculateSwapPressure(shift, shift, ctx);

    expect(breakdown.score).toBe(0);
    expect(breakdown.baselineScore).toBe(0);
    expect(breakdown.swappedScore).toBe(0);
    expect(breakdown.original.calls).toHaveLength(0);
    expect(breakdown.counterpart.calls).toHaveLength(0);
  });

  it('reduces the swap score by 50 when Moses Senior swaps have mismatched IP consult coverage', () => {
    const residentA = buildResident('R1', ['MOSES', 'IP CONSULT']);
    const residentB = buildResident('R2', ['MOSES', 'IP CONSULT']);

    const seniorShiftA = buildShift(
      '2025-10-04_MOSES_SR',
      'R1',
      '2025-10-04T13:00:00Z',
      '2025-10-04T23:00:00Z',
      'MOSES',
      'Moses Senior',
    );
    const seniorShiftB = buildShift(
      '2025-10-12_MOSES_SR',
      'R2',
      '2025-10-12T13:00:00Z',
      '2025-10-12T23:00:00Z',
      'MOSES',
      'Moses Senior',
    );
    const neutralShiftA = buildShift(
      '2025-10-04_MOSES',
      'R1',
      '2025-10-04T13:00:00Z',
      '2025-10-04T23:00:00Z',
      'MOSES',
      'Moses',
    );
    const neutralShiftB = buildShift(
      '2025-10-12_MOSES',
      'R2',
      '2025-10-12T13:00:00Z',
      '2025-10-12T23:00:00Z',
      'MOSES',
      'Moses',
    );
    const ipConsultA = buildShift(
      'IP-R1-2025-10-04',
      'R1',
      '2025-10-04T17:00:00Z',
      '2025-10-05T03:00:00Z',
      'IP CONSULT',
      'IP Consult',
    );

    const ctxWithPenalty = buildContext(
      [residentA, residentB],
      {
        R1: [seniorShiftA, ipConsultA],
        R2: [seniorShiftB],
      },
      { restHoursMin: 0 },
    );

    const ctxWithoutPenalty = buildContext(
      [residentA, residentB],
      {
        R1: [neutralShiftA, ipConsultA],
        R2: [neutralShiftB],
      },
      { restHoursMin: 0 },
    );

    const withPenalty = calculateSwapPressure(seniorShiftA, seniorShiftB, ctxWithPenalty);
    const withoutPenalty = calculateSwapPressure(neutralShiftA, neutralShiftB, ctxWithoutPenalty);

    expect(withoutPenalty.score - withPenalty.score).toBeCloseTo(50, 6);
    const penaltyCalls = [...withPenalty.original.calls, ...withPenalty.counterpart.calls].filter(
      (call) => call.shiftId.startsWith('penalty:ip-consult:'),
    );
    expect(penaltyCalls).toHaveLength(2);
  });

  it('does not change the swap score when both Moses Senior swaps include IP consult coverage', () => {
    const residentA = buildResident('R1', ['MOSES', 'IP CONSULT']);
    const residentB = buildResident('R2', ['MOSES', 'IP CONSULT']);

    const seniorShiftA = buildShift(
      '2025-10-04_MOSES_SR',
      'R1',
      '2025-10-04T13:00:00Z',
      '2025-10-04T23:00:00Z',
      'MOSES',
      'Moses Senior',
    );
    const seniorShiftB = buildShift(
      '2025-10-12_MOSES_SR',
      'R2',
      '2025-10-12T13:00:00Z',
      '2025-10-12T23:00:00Z',
      'MOSES',
      'Moses Senior',
    );
    const neutralShiftA = buildShift(
      '2025-10-04_MOSES',
      'R1',
      '2025-10-04T13:00:00Z',
      '2025-10-04T23:00:00Z',
      'MOSES',
      'Moses',
    );
    const neutralShiftB = buildShift(
      '2025-10-12_MOSES',
      'R2',
      '2025-10-12T13:00:00Z',
      '2025-10-12T23:00:00Z',
      'MOSES',
      'Moses',
    );
    const ipConsultA = buildShift(
      'IP-R1-2025-10-04',
      'R1',
      '2025-10-04T17:00:00Z',
      '2025-10-05T03:00:00Z',
      'IP CONSULT',
      'IP Consult',
    );
    const ipConsultB = buildShift(
      'IP-R2-2025-10-12',
      'R2',
      '2025-10-12T17:00:00Z',
      '2025-10-13T03:00:00Z',
      'IP CONSULT',
      'IP Consult',
    );

    const ctxSenior = buildContext(
      [residentA, residentB],
      {
        R1: [seniorShiftA, ipConsultA],
        R2: [seniorShiftB, ipConsultB],
      },
      { restHoursMin: 0 },
    );

    const ctxNeutral = buildContext(
      [residentA, residentB],
      {
        R1: [neutralShiftA, ipConsultA],
        R2: [neutralShiftB, ipConsultB],
      },
      { restHoursMin: 0 },
    );

    const seniorBreakdown = calculateSwapPressure(seniorShiftA, seniorShiftB, ctxSenior);
    const neutralBreakdown = calculateSwapPressure(neutralShiftA, neutralShiftB, ctxNeutral);

    expect(neutralBreakdown.score - seniorBreakdown.score).toBeCloseTo(0, 6);
    const penaltyCalls = [
      ...seniorBreakdown.original.calls,
      ...seniorBreakdown.counterpart.calls,
    ].filter((call) => call.shiftId.startsWith('penalty:ip-consult:'));
    expect(penaltyCalls).toHaveLength(0);
  });

  it('adds a rotation pressure bonus when removing a call from a priority rotation', () => {
    const giRotation: RotationAssignment = {
      weekStartISO: '2025-10-06T00:00:00.000Z',
      rotation: 'GI',
      rawRotation: 'GI',
      vacationDates: [],
    };

    const residentAWithRotation = buildResident('R1', ['MOSES'], [giRotation]);
    const residentAWithoutRotation = buildResident('R1', ['MOSES']);
    const residentB = buildResident('R2', ['MOSES']);

    const shiftA = buildShift('SA', 'R1', '2025-10-07T08:00:00Z', '2025-10-07T18:00:00Z', 'MOSES');
    const shiftB = buildShift('SB', 'R2', '2025-10-20T08:00:00Z', '2025-10-20T18:00:00Z', 'MOSES');

    const ctxWithBonus = buildContext(
      [residentAWithRotation, residentB],
      {
        R1: [shiftA],
        R2: [shiftB],
      },
      { restHoursMin: 0 },
    );

    const ctxWithoutBonus = buildContext(
      [residentAWithoutRotation, buildResident('R2', ['MOSES'])],
      {
        R1: [shiftA],
        R2: [shiftB],
      },
      { restHoursMin: 0 },
    );

    const withBonus = calculateSwapPressure(shiftA, shiftB, ctxWithBonus);
    const withoutBonus = calculateSwapPressure(shiftA, shiftB, ctxWithoutBonus);

    expect(withBonus.score - withoutBonus.score).toBeCloseTo(100, 6);

    const rotationCall = withBonus.original.calls.find((call) =>
      call.shiftId.startsWith('bonus:rotation:baseline:'),
    );
    expect(rotationCall?.delta).toBeCloseTo(100, 6);
    expect(rotationCall?.rotationLabel ?? '').toContain('GI');
  });

  it('penalizes swaps that assign a priority rotation call to another resident', () => {
    const angioRotation: RotationAssignment = {
      weekStartISO: '2025-10-06T00:00:00.000Z',
      rotation: 'Angio',
      rawRotation: 'Angio',
      vacationDates: [],
    };

    const residentA = buildResident('R1', ['MOSES']);
    const residentBWithRotation = buildResident('R2', ['MOSES'], [angioRotation]);
    const residentBWithoutRotation = buildResident('R2', ['MOSES']);

    const shiftA = buildShift('SA', 'R1', '2025-10-07T08:00:00Z', '2025-10-07T18:00:00Z', 'MOSES');
    const shiftB = buildShift('SB', 'R2', '2025-10-20T08:00:00Z', '2025-10-20T18:00:00Z', 'MOSES');

    const ctxWithPenalty = buildContext(
      [residentA, residentBWithRotation],
      {
        R1: [shiftA],
        R2: [shiftB],
      },
      { restHoursMin: 0 },
    );

    const ctxWithoutPenalty = buildContext(
      [buildResident('R1', ['MOSES']), residentBWithoutRotation],
      {
        R1: [shiftA],
        R2: [shiftB],
      },
      { restHoursMin: 0 },
    );

    const withPenalty = calculateSwapPressure(shiftA, shiftB, ctxWithPenalty);
    const withoutPenalty = calculateSwapPressure(shiftA, shiftB, ctxWithoutPenalty);

    expect(withPenalty.score - withoutPenalty.score).toBeCloseTo(-100, 6);

    const rotationCall = withPenalty.counterpart.calls.find((call) =>
      call.shiftId.startsWith('bonus:rotation:swapped:'),
    );
    expect(rotationCall?.delta).toBeCloseTo(-100, 6);
    expect(rotationCall?.rotationLabel ?? '').toContain('Angio');
  });
});
