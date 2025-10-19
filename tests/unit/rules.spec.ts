import { describe, it, expect } from 'vitest';
import {
  RuleViolationError,
  validateResidentTimeline,
  isFeasibleSwap,
  explainSwap,
} from '../../src/domain/rules';
import { Context, Resident, RuleConfig, Shift } from '../../src/domain/types';
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

describe('validateResidentTimeline', () => {
  it('allows sorted non-overlapping eligible shifts', () => {
    const resident = buildResident('R1', ['MOSES', 'WEILER']);
    const shifts = [
      buildShift('S1', 'R1', '2025-10-01T08:00:00Z', '2025-10-01T16:00:00Z', 'MOSES'),
      buildShift('S2', 'R1', '2025-10-02T08:00:00Z', '2025-10-02T16:00:00Z', 'WEILER'),
    ];

    const advisories = validateResidentTimeline(shifts, baseRuleConfig, resident);
    expect(advisories).toHaveLength(0);
  });

  it('throws overlap violation for overlapping shifts', () => {
    const resident = buildResident('R1', ['MOSES']);
    const shifts = [
      buildShift('S1', 'R1', '2025-10-01T08:00:00Z', '2025-10-01T16:00:00Z', 'MOSES'),
      buildShift('S2', 'R1', '2025-10-01T15:00:00Z', '2025-10-01T23:00:00Z', 'MOSES'),
    ];

    let caught: unknown;
    try {
      validateResidentTimeline(shifts, baseRuleConfig, resident);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RuleViolationError);
    expect((caught as RuleViolationError | undefined)?.code).toBe('OVERLAP');
  });

  it('throws rest window violation when gap is too small', () => {
    const config: RuleConfig = { ...baseRuleConfig, restHoursMin: 12 };
    const resident = buildResident('R1', ['MOSES']);
    const shifts = [
      buildShift('S1', 'R1', '2025-10-01T08:00:00Z', '2025-10-01T20:00:00Z', 'MOSES'),
      buildShift('S2', 'R1', '2025-10-02T05:00:00Z', '2025-10-02T14:00:00Z', 'MOSES'),
    ];

    let caught: unknown;
    try {
      validateResidentTimeline(shifts, config, resident);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RuleViolationError);
    expect((caught as RuleViolationError | undefined)?.code).toBe('REST_WINDOW');
  });

  it('throws eligibility violation when resident lacks shift type', () => {
    const resident = buildResident('R1', ['WEILER']);
    const shifts = [
      buildShift('S1', 'R1', '2025-10-01T08:00:00Z', '2025-10-01T16:00:00Z', 'MOSES'),
    ];

    let caught: unknown;
    try {
      validateResidentTimeline(shifts, baseRuleConfig, resident);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RuleViolationError);
    expect((caught as RuleViolationError | undefined)?.code).toBe('ELIGIBILITY');
  });

  it('returns advisory when rest window violation only involves a backup shift', () => {
    const resident = buildResident('R1', ['MOSES', 'BACKUP']);
    const backupShift = buildShift(
      'B1',
      'R1',
      '2025-10-01T08:00:00Z',
      '2025-10-01T16:00:00Z',
      'BACKUP',
    );
    const incoming = buildShift(
      'S1',
      'R1',
      '2025-10-01T18:00:00Z',
      '2025-10-01T23:00:00Z',
      'MOSES',
    );

    const advisories = validateResidentTimeline([backupShift, incoming], baseRuleConfig, resident, {
      focusShiftIds: new Set(['S1']),
      softTypes: new Set(['BACKUP']),
    });

    expect(advisories).toHaveLength(1);
    expect(advisories[0]?.code).toBe('REST_WINDOW');
  });

  it('ignores rest window checks between consecutive backup shifts', () => {
    const resident = buildResident('R1', ['BACKUP']);
    const firstBackup = buildShift(
      'B1',
      'R1',
      '2025-10-01T08:00:00Z',
      '2025-10-01T16:00:00Z',
      'BACKUP',
    );
    const secondBackup = buildShift(
      'B2',
      'R1',
      '2025-10-01T16:00:00Z',
      '2025-10-01T23:00:00Z',
      'BACKUP',
    );

    const advisories = validateResidentTimeline(
      [firstBackup, secondBackup],
      { ...baseRuleConfig, restHoursMin: 8 },
      resident,
      { softTypes: new Set(['BACKUP']) },
    );

    expect(advisories).toHaveLength(0);
  });

  it('treats spring forward rest gaps below minimum as violations', () => {
    const config: RuleConfig = { ...baseRuleConfig, restHoursMin: 8 };
    const resident = buildResident('R1', ['MOSES']);
    const shifts = [
      buildShift(
        'SPRING_CALL',
        'R1',
        '2024-03-09T16:30:00-05:00',
        '2024-03-10T00:30:00-05:00',
        'MOSES',
      ),
      buildShift(
        'SPRING_POST',
        'R1',
        '2024-03-10T08:30:00-04:00',
        '2024-03-10T16:30:00-04:00',
        'MOSES',
      ),
    ];

    expect(() => validateResidentTimeline(shifts, config, resident)).toThrowError(
      RuleViolationError,
    );
  });

  it('allows fall back rest gaps that still meet the minimum', () => {
    const config: RuleConfig = { ...baseRuleConfig, restHoursMin: 8 };
    const resident = buildResident('R1', ['MOSES']);
    const shifts = [
      buildShift(
        'FALL_CALL',
        'R1',
        '2024-11-02T16:30:00-04:00',
        '2024-11-03T00:30:00-04:00',
        'MOSES',
      ),
      buildShift(
        'FALL_POST',
        'R1',
        '2024-11-03T08:30:00-05:00',
        '2024-11-03T16:30:00-05:00',
        'MOSES',
      ),
    ];

    expect(() => validateResidentTimeline(shifts, config, resident)).not.toThrow();
  });
});

describe('isFeasibleSwap', () => {
  function buildContext(
    shiftsA: Shift[],
    shiftsB: Shift[],
    overrides?: Partial<RuleConfig>,
  ): { ctx: Context; shiftA: Shift; shiftB: Shift; residentA: Resident; residentB: Resident } {
    const residentA = buildResident('R1', ['MOSES', 'WEILER']);
    const residentB = buildResident('R2', ['MOSES', 'WEILER']);
    const cfg: RuleConfig = { ...baseRuleConfig, ...overrides };
    const shiftA = shiftsA.find((s) => s.residentId === 'R1');
    const shiftB = shiftsB.find((s) => s.residentId === 'R2');
    if (!shiftA || !shiftB) {
      throw new Error('Context builder requires one shift for each resident');
    }
    const shiftsByResidentEntries: Array<[string, Shift[]]> = [
      [residentA.id, [...shiftsA]],
      [residentB.id, [...shiftsB]],
    ];
    const ctx = buildContextWithShifts(cfg, [residentA, residentB], shiftsByResidentEntries);
    return { ctx, shiftA, shiftB, residentA, residentB };
  }

  it('accepts swap when constraints satisfied for both residents', () => {
    const shiftA = buildShift('S1', 'R1', '2025-10-06T08:00:00Z', '2025-10-06T20:00:00Z', 'MOSES');
    const shiftB = buildShift('S2', 'R2', '2025-10-08T08:00:00Z', '2025-10-08T20:00:00Z', 'WEILER');
    const { ctx } = buildContext([shiftA], [shiftB]);

    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(true);
    expect(isFeasibleSwap(shiftB, shiftA, ctx)).toBe(true);
  });

  it('rejects swap when eligibility fails', () => {
    const residentA = buildResident('R1', ['MOSES']);
    const residentB = buildResident('R2', ['WEILER']);
    const shiftA = buildShift('S1', 'R1', '2025-10-05T08:00:00Z', '2025-10-05T20:00:00Z', 'MOSES');
    const shiftB = buildShift('S2', 'R2', '2025-10-07T08:00:00Z', '2025-10-07T20:00:00Z', 'WEILER');
    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        [residentA.id, [shiftA]],
        [residentB.id, [shiftB]],
      ],
    );

    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(false);
  });

  it('rejects swap when rest window would be violated', () => {
    const existingA = buildShift(
      'S0',
      'R1',
      '2025-10-07T00:00:00Z',
      '2025-10-07T07:00:00Z',
      'MOSES',
    );
    const shiftA = buildShift('S1', 'R1', '2025-10-06T08:00:00Z', '2025-10-06T20:00:00Z', 'WEILER');
    const shiftB = buildShift('S2', 'R2', '2025-10-07T08:00:00Z', '2025-10-07T16:00:00Z', 'MOSES');
    const residentA = buildResident('R1', ['MOSES', 'WEILER']);
    const residentB = buildResident('R2', ['MOSES', 'WEILER']);
    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        [residentA.id, [existingA, shiftA]],
        [residentB.id, [shiftB]],
      ],
    );

    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(false);
  });

  it('rejects swap when counterparty rest window would be violated', () => {
    const shiftA = buildShift('S1', 'R1', '2025-10-06T08:00:00Z', '2025-10-06T20:00:00Z', 'MOSES');
    const existingB = buildShift(
      'S0',
      'R2',
      '2025-10-06T23:00:00Z',
      '2025-10-07T07:00:00Z',
      'WEILER',
    );
    const shiftB = buildShift('S2', 'R2', '2025-10-07T08:00:00Z', '2025-10-07T20:00:00Z', 'WEILER');
    const residentA = buildResident('R1', ['MOSES', 'WEILER']);
    const residentB = buildResident('R2', ['MOSES', 'WEILER']);
    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        [residentA.id, [shiftA]],
        [residentB.id, [existingB, shiftB]],
      ],
    );

    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(false);
  });

  it('rejects IP consult swaps when the recipient is on a restricted rotation', () => {
    const restrictedRotations = ['Angio', 'GI'];

    for (const rotation of restrictedRotations) {
      const rotationAssignment = {
        weekStartISO: '2025-10-06T00:00:00Z',
        rotation,
        rawRotation: rotation,
        vacationDates: [],
      };

      const residentA = buildResident('R1', ['MOSES', 'IP CONSULT']);
      const residentB = buildResident('R2', ['MOSES', 'IP CONSULT'], [rotationAssignment]);

      const ipConsultShift = buildShift(
        'IPC1',
        residentA.id,
        '2025-10-08T08:00:00Z',
        '2025-10-08T20:00:00Z',
        'IP CONSULT',
      );
      const counterpartShift = buildShift(
        'CALL1',
        residentB.id,
        '2025-10-09T08:00:00Z',
        '2025-10-09T20:00:00Z',
        'MOSES',
      );

      const ctx = buildContextWithShifts(
        baseRuleConfig,
        [residentA, residentB],
        [
          [residentA.id, [ipConsultShift]],
          [residentB.id, [counterpartShift]],
        ],
      );

      const evaluation = explainSwap(ipConsultShift, counterpartShift, ctx);
      expect(evaluation.feasible).toBe(false);
      if (!evaluation.feasible) {
        expect(evaluation.reason.kind).toBe('ip-consult-rotation-ban');
        if (evaluation.reason.kind === 'ip-consult-rotation-ban') {
          expect(evaluation.reason.rotation).toBe(rotation);
        }
      }
      expect(isFeasibleSwap(ipConsultShift, counterpartShift, ctx)).toBe(false);
    }
  });

  it('rejects swap when mixing weekend or holiday shifts with weekday shifts', () => {
    const weekendShift = buildShift(
      'S_weekend',
      'R1',
      '2025-10-05T08:00:00Z',
      '2025-10-05T20:00:00Z',
      'MOSES',
    );
    const weekdayShift = buildShift(
      'S_weekday',
      'R2',
      '2025-10-08T08:00:00Z',
      '2025-10-08T20:00:00Z',
      'MOSES',
    );
    const { ctx } = buildContext([weekendShift], [weekdayShift]);

    expect(isFeasibleSwap(weekendShift, weekdayShift, ctx)).toBe(false);
    expect(isFeasibleSwap(weekdayShift, weekendShift, ctx)).toBe(false);
  });

  it('allows swap but surfaces advisory when a backup rest window is too short', () => {
    const backup = buildShift('B1', 'R1', '2025-10-07T00:00:00Z', '2025-10-07T06:00:00Z', 'BACKUP');
    const shiftA = buildShift('S1', 'R1', '2025-10-06T08:00:00Z', '2025-10-06T20:00:00Z', 'MOSES');
    const shiftB = buildShift('S2', 'R2', '2025-10-07T10:00:00Z', '2025-10-07T20:00:00Z', 'MOSES');
    const residentA = buildResident('R1', ['MOSES', 'BACKUP']);
    const residentB = buildResident('R2', ['MOSES', 'BACKUP']);
    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        [residentA.id, [backup, shiftA]],
        [residentB.id, [shiftB]],
      ],
    );

    const evaluation = explainSwap(shiftA, shiftB, ctx);
    expect(evaluation.feasible).toBe(true);
    expect(evaluation.advisories?.some((advisory) => advisory.code === 'REST_WINDOW')).toBe(true);
    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(true);
  });

  it('rejects swap when the incoming shift overlaps a vacation day', () => {
    const residentA = buildResident(
      'R1',
      ['MOSES'],
      [
        {
          weekStartISO: '2025-10-06T00:00:00.000Z',
          rotation: 'Chest',
          rawRotation: 'Chest (V12-13)',
          vacationDates: ['2025-10-12', '2025-10-13'],
        },
      ],
    );
    const residentB = buildResident('R2', ['MOSES']);
    const shiftA = buildShift('S1', 'R1', '2025-10-09T08:00:00Z', '2025-10-09T20:00:00Z', 'MOSES');
    const shiftB = buildShift('S2', 'R2', '2025-10-13T08:00:00Z', '2025-10-13T20:00:00Z', 'MOSES');

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        [residentA.id, [shiftA]],
        [residentB.id, [shiftB]],
      ],
    );

    const evaluation = explainSwap(shiftA, shiftB, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('vacation-conflict');
      if (evaluation.reason.kind === 'vacation-conflict') {
        expect(evaluation.reason.residentId).toBe('R1');
        expect(evaluation.reason.conflictDates).toContain('2025-10-13');
      }
    }
    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(false);
  });

  it('rejects weekend swaps that overlap a vacation day', () => {
    const residentA = buildResident(
      'R1',
      ['MOSES'],
      [
        {
          weekStartISO: '2025-10-06T00:00:00.000Z',
          rotation: 'Chest',
          rawRotation: 'Chest (V11-12)',
          vacationDates: ['2025-10-11'],
        },
      ],
    );
    const residentB = buildResident('R2', ['MOSES']);
    const shiftA = buildShift('S1', 'R1', '2025-10-04T08:00:00Z', '2025-10-04T20:00:00Z', 'MOSES');
    const weekendShift = buildShift(
      'S2-weekend',
      'R2',
      '2025-10-11T08:00:00Z',
      '2025-10-11T20:00:00Z',
      'MOSES',
    );

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        [residentA.id, [shiftA]],
        [residentB.id, [weekendShift]],
      ],
    );

    const evaluation = explainSwap(shiftA, weekendShift, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('vacation-conflict');
      if (evaluation.reason.kind === 'vacation-conflict') {
        expect(evaluation.reason.residentId).toBe('R1');
        expect(evaluation.reason.conflictDates).toContain('2025-10-11');
      }
    }
    expect(isFeasibleSwap(shiftA, weekendShift, ctx)).toBe(false);
  });

  it('rejects swap when the incoming shift falls during a blocked rotation week', () => {
    const residentA = buildResident(
      'R1',
      ['MOSES'],
      [
        {
          weekStartISO: '2025-10-06T00:00:00.000Z',
          rotation: 'Vacation',
          rawRotation: 'Vacation',
          vacationDates: [],
        },
      ],
    );
    const residentB = buildResident('R2', ['MOSES']);
    const shiftA = buildShift('S1', 'R1', '2025-10-01T08:00:00Z', '2025-10-01T20:00:00Z', 'MOSES');
    const shiftB = buildShift('S2', 'R2', '2025-10-07T08:00:00Z', '2025-10-07T20:00:00Z', 'MOSES');

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        [residentA.id, [shiftA]],
        [residentB.id, [shiftB]],
      ],
    );

    const evaluation = explainSwap(shiftA, shiftB, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('rotation-block');
      if (evaluation.reason.kind === 'rotation-block') {
        expect(evaluation.reason.residentId).toBe('R1');
        expect(evaluation.reason.rotation).toContain('Vacation');
        expect(evaluation.reason.conflictDates).toContain('2025-10-07');
      }
    }
    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(false);
  });

  it('rejects swap when the incoming shift lands on the weekend flanking a blocked rotation', () => {
    const residentA = buildResident(
      'R1',
      ['MOSES'],
      [
        {
          weekStartISO: '2025-10-06T00:00:00.000Z',
          rotation: 'US Scanning',
          rawRotation: 'US Scanning',
          vacationDates: [],
        },
      ],
    );
    const residentB = buildResident('R2', ['MOSES']);
    const shiftA = buildShift('S1', 'R1', '2025-09-28T08:00:00Z', '2025-09-28T20:00:00Z', 'MOSES');
    const shiftB = buildShift('S2', 'R2', '2025-10-05T08:00:00Z', '2025-10-05T20:00:00Z', 'MOSES');

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        [residentA.id, [shiftA]],
        [residentB.id, [shiftB]],
      ],
    );

    const evaluation = explainSwap(shiftA, shiftB, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('rotation-block');
      if (evaluation.reason.kind === 'rotation-block') {
        expect(evaluation.reason.residentId).toBe('R1');
        expect(evaluation.reason.rotation).toContain('US Scanning');
        expect(evaluation.reason.conflictDates).toContain('2025-10-05');
      }
    }
    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(false);
  });

  it('rejects swap when MRI course week would place an R3 resident on call', () => {
    const residentR3 = buildResident(
      'R3',
      ['MOSES'],
      [
        {
          weekStartISO: '2025-10-06T00:00:00.000Z',
          rotation: 'MRI Course',
          rawRotation: 'MRI Course',
          vacationDates: [],
        },
      ],
      [
        {
          academicYearStartISO: '2025-07-01T00:00:00.000Z',
          label: 'R3',
        },
      ],
    );
    const residentB = buildResident('R4', ['MOSES']);
    const shiftA = buildShift('S1', 'R3', '2025-10-01T08:00:00Z', '2025-10-01T20:00:00Z', 'MOSES');
    const shiftB = buildShift('S2', 'R4', '2025-10-09T08:00:00Z', '2025-10-09T20:00:00Z', 'MOSES');

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
        expect(evaluation.reason.rotation).toContain('MRI Course');
        expect(evaluation.reason.conflictDates).toContain('2025-10-09');
      }
    }
    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(false);
  });

  it('allows swap during MRI course for a resident outside the R3 academic year', () => {
    const residentA = buildResident(
      'R1',
      ['MOSES'],
      [
        {
          weekStartISO: '2025-10-06T00:00:00.000Z',
          rotation: 'MRI Course',
          rawRotation: 'MRI Course',
          vacationDates: [],
        },
      ],
      [
        {
          academicYearStartISO: '2025-07-01T00:00:00.000Z',
          label: 'R4 DR',
        },
      ],
    );
    const residentB = buildResident('R2', ['MOSES']);
    const shiftA = buildShift('S1', 'R1', '2025-10-01T08:00:00Z', '2025-10-01T20:00:00Z', 'MOSES');
    const shiftB = buildShift('S2', 'R2', '2025-10-09T08:00:00Z', '2025-10-09T20:00:00Z', 'MOSES');

    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        [residentA.id, [shiftA]],
        [residentB.id, [shiftB]],
      ],
    );

    const evaluation = explainSwap(shiftA, shiftB, ctx);
    expect(evaluation.feasible).toBe(true);
    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(true);
  });

  it('ignores unrelated timeline violations when evaluating a swap', () => {
    const conflictingEarly = buildShift(
      'C1',
      'R1',
      '2025-09-01T08:00:00Z',
      '2025-09-01T16:00:00Z',
      'MOSES',
    );
    const conflictingLate = buildShift(
      'C2',
      'R1',
      '2025-09-01T22:00:00Z',
      '2025-09-02T06:00:00Z',
      'MOSES',
    );
    const shiftA = buildShift('S1', 'R1', '2025-10-06T08:00:00Z', '2025-10-06T20:00:00Z', 'MOSES');
    const shiftB = buildShift('S2', 'R2', '2025-10-08T08:00:00Z', '2025-10-08T20:00:00Z', 'MOSES');
    const residentA = buildResident('R1', ['MOSES']);
    const residentB = buildResident('R2', ['MOSES']);
    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [residentA, residentB],
      [
        [residentA.id, [conflictingEarly, conflictingLate, shiftA]],
        [residentB.id, [shiftB]],
      ],
    );

    const evaluation = explainSwap(shiftA, shiftB, ctx);
    expect(evaluation.feasible).toBe(true);
    expect(evaluation.advisories ?? []).toHaveLength(0);
    expect(isFeasibleSwap(shiftA, shiftB, ctx)).toBe(true);
  });

  it('provides rejection diagnostics via explainSwap', () => {
    const shiftA = buildShift('S1', 'R1', '2025-10-05T08:00:00Z', '2025-10-05T20:00:00Z', 'MOSES');
    const shiftB = buildShift('S2', 'R1', '2025-10-07T08:00:00Z', '2025-10-07T20:00:00Z', 'MOSES');
    const ctx = buildContextWithShifts(baseRuleConfig, [], []);

    const evaluation = explainSwap(shiftA, shiftB, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('same-resident');
    }
  });

  it('rejects swaps into Friday calls for Shabbos observers', () => {
    const shabbosResident = buildResident('R1', ['MOSES']);
    const otherResident = buildResident('R2', ['MOSES']);
    const originalShift = buildShift(
      'S_orig',
      'R1',
      '2025-10-09T08:00:00Z',
      '2025-10-09T20:00:00Z',
      'MOSES',
    );
    const fridayCall = buildShift(
      'S_fri',
      'R2',
      '2025-10-10T08:00:00Z',
      '2025-10-10T20:00:00Z',
      'MOSES',
    );
    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [shabbosResident, otherResident],
      [
        [shabbosResident.id, [originalShift]],
        [otherResident.id, [fridayCall]],
      ],
    );

    const evaluation = explainSwap(originalShift, fridayCall, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('shabbos-restriction');
      if (evaluation.reason.kind === 'shabbos-restriction') {
        expect(evaluation.reason.restriction).toBe('observer-friday-call');
      }
    }
  });

  it('rejects swaps into Saturday daytime calls for Shabbos observers', () => {
    const shabbosResident = buildResident('R1', ['MOSES']);
    const otherResident = buildResident('R2', ['MOSES']);
    const originalShift = buildShift(
      'S_orig',
      'R1',
      '2025-10-12T13:00:00Z',
      '2025-10-12T21:00:00Z',
      'MOSES',
    );
    const saturdayDaytime = buildShift(
      'S_sat_day',
      'R2',
      '2025-10-11T13:00:00Z',
      '2025-10-11T21:00:00Z',
      'MOSES',
    );
    const ctx = buildContextWithShifts(
      baseRuleConfig,
      [shabbosResident, otherResident],
      [
        [shabbosResident.id, [originalShift]],
        [otherResident.id, [saturdayDaytime]],
      ],
    );

    const evaluation = explainSwap(originalShift, saturdayDaytime, ctx);
    expect(evaluation.feasible).toBe(false);
    if (!evaluation.feasible) {
      expect(evaluation.reason.kind).toBe('shabbos-restriction');
      if (evaluation.reason.kind === 'shabbos-restriction') {
        expect(evaluation.reason.restriction).toBe('observer-saturday-daytime');
      }
    }
  });

  it('allows Saturday night float swaps for Shabbos observers but still blocks other nights', () => {
    const shabbosResident = buildResident('R1', ['NIGHT FLOAT']);
    const saturdayCounterpart = buildResident('R2', ['NIGHT FLOAT']);
    const sundayCounterpart = buildResident('R3', ['NIGHT FLOAT']);

    const originalNightFloat = buildShift(
      'S_nf_orig',
      'R1',
      '2025-10-04T22:00:00Z',
      '2025-10-05T09:00:00Z',
      'NIGHT FLOAT',
    );
    const saturdayNightFloat = buildShift(
      'S_nf_sat',
      'R2',
      '2025-10-11T22:00:00Z',
      '2025-10-12T09:00:00Z',
      'NIGHT FLOAT',
    );
    const sundayNightFloat = buildShift(
      'S_nf_sun',
      'R3',
      '2025-10-12T22:00:00Z',
      '2025-10-13T09:00:00Z',
      'NIGHT FLOAT',
    );

    const saturdayCtx = buildContextWithShifts(
      baseRuleConfig,
      [shabbosResident, saturdayCounterpart],
      [
        [shabbosResident.id, [originalNightFloat]],
        [saturdayCounterpart.id, [saturdayNightFloat]],
      ],
    );

    const saturdayEvaluation = explainSwap(originalNightFloat, saturdayNightFloat, saturdayCtx);
    expect(saturdayEvaluation.feasible).toBe(true);

    const sundayCtx = buildContextWithShifts(
      baseRuleConfig,
      [shabbosResident, sundayCounterpart],
      [
        [shabbosResident.id, [originalNightFloat]],
        [sundayCounterpart.id, [sundayNightFloat]],
      ],
    );

    const sundayEvaluation = explainSwap(originalNightFloat, sundayNightFloat, sundayCtx);
    expect(sundayEvaluation.feasible).toBe(false);
    if (!sundayEvaluation.feasible) {
      expect(sundayEvaluation.reason.kind).toBe('shabbos-restriction');
      if (sundayEvaluation.reason.kind === 'shabbos-restriction') {
        expect(sundayEvaluation.reason.restriction).toBe('observer-night-float');
      }
    }
  });

  it('allows Saturday night float swaps for non-Shabbos residents but rejects other nights', () => {
    const nonShabbosResident = buildResident('R1', ['NIGHT FLOAT', 'MOSES']);
    const saturdayDayCall = buildShift(
      'S_sat_day_resident',
      'R1',
      '2025-10-04T13:00:00Z',
      '2025-10-04T21:00:00Z',
      'MOSES',
    );
    const saturdayNightFloat = buildShift(
      'S_nf_sat',
      'R1',
      '2025-10-11T22:00:00Z',
      '2025-10-12T09:00:00Z',
      'NIGHT FLOAT',
    );
    const sundayNightFloat = buildShift(
      'S_nf_sun',
      'R2',
      '2025-10-12T22:00:00Z',
      '2025-10-13T09:00:00Z',
      'NIGHT FLOAT',
    );
    const counterpartSaturdayDay = buildShift(
      'S_sat_day_counterpart',
      'R2',
      '2025-10-04T09:00:00Z',
      '2025-10-04T19:00:00Z',
      'MOSES',
    );
    const counterpartResident = buildResident('R2', ['NIGHT FLOAT', 'MOSES']);
    const ctxBase = buildContextWithShifts(
      baseRuleConfig,
      [nonShabbosResident, counterpartResident],
      [
        [nonShabbosResident.id, [saturdayDayCall, saturdayNightFloat]],
        [counterpartResident.id, [counterpartSaturdayDay, sundayNightFloat]],
      ],
    );

    const saturdayEvaluation = explainSwap(saturdayNightFloat, sundayNightFloat, ctxBase);
    expect(saturdayEvaluation.feasible).toBe(false);
    if (!saturdayEvaluation.feasible) {
      expect(saturdayEvaluation.reason.kind).toBe('shabbos-restriction');
      if (saturdayEvaluation.reason.kind === 'shabbos-restriction') {
        expect(saturdayEvaluation.reason.restriction).toBe('nonobserver-night-float');
      }
    }

    const alternateCounterpartSaturdayDay = buildShift(
      'S_sat_day_alt',
      'R3',
      '2025-10-04T09:30:00Z',
      '2025-10-04T19:30:00Z',
      'MOSES',
    );
    const alternateCounterpart = buildResident('R3', ['NIGHT FLOAT', 'MOSES']);
    const saturdayNightFloatOther = buildShift(
      'S_nf_sat_other',
      'R3',
      '2025-10-11T22:00:00Z',
      '2025-10-12T09:00:00Z',
      'NIGHT FLOAT',
    );
    const ctxAllowed = buildContextWithShifts(
      baseRuleConfig,
      [nonShabbosResident, alternateCounterpart],
      [
        [nonShabbosResident.id, [saturdayDayCall, saturdayNightFloat]],
        [alternateCounterpart.id, [alternateCounterpartSaturdayDay, saturdayNightFloatOther]],
      ],
    );

    const allowedEvaluation = explainSwap(saturdayNightFloat, saturdayNightFloatOther, ctxAllowed);
    expect(allowedEvaluation.feasible).toBe(true);
  });
});
