import { afterEach, describe, expect, it, vi } from 'vitest';
import { findSwapsForShift, findBestSwaps } from '../../src/engine/swapEngine';
import { terminatePool } from '../../src/engine/workerPool';
import type { Dataset, Shift } from '../../src/domain/types';
import { parseCsvToDataset } from '../../src/utils/csv';
import * as workerPool from '../../src/engine/workerPool';
import type { ShiftPair } from '../../src/engine/workerProtocol';
import * as rules from '../../src/domain/rules';
import * as debug from '../../src/utils/debug';

describe('swapEngine', () => {
  afterEach(() => {
    terminatePool();
  });

  it('returns feasible swap candidates when residents have other shift types', async () => {
    const dataset: Dataset = {
      residents: [
        {
          id: 'R1',
          name: 'Resident One',
          eligibleShiftTypes: ['MOSES', 'WEILER', 'BACKUP'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'R2',
          name: 'Resident Two',
          eligibleShiftTypes: ['MOSES', 'WEILER', 'BACKUP'],
          rotations: [],
          academicYears: [],
        },
      ],
      shifts: [
        {
          id: 'S1',
          residentId: 'R1',
          startISO: '2025-01-01T22:00:00Z',
          endISO: '2025-01-02T03:00:00Z',
          type: 'MOSES',
          location: 'Unit A',
        },
        {
          id: 'S1_WEILER',
          residentId: 'R1',
          startISO: '2025-01-05T22:00:00Z',
          endISO: '2025-01-06T03:00:00Z',
          type: 'WEILER',
          location: 'Unit B',
        },
        {
          id: 'S2',
          residentId: 'R2',
          startISO: '2025-01-02T22:00:00Z',
          endISO: '2025-01-03T03:00:00Z',
          type: 'MOSES',
          location: 'Unit A',
        },
        {
          id: 'S2_BACKUP',
          residentId: 'R2',
          startISO: '2025-01-04T13:00:00Z',
          endISO: '2025-01-05T13:00:00Z',
          type: 'BACKUP',
          location: 'Unit C',
        },
      ],
    };

    const target = dataset.shifts[0]!;
    const { accepted: swaps } = await findSwapsForShift(dataset, target, {
      today: '2024-12-31T12:00:00Z',
    });

    expect(swaps.length).toBeGreaterThan(0);
    const [first] = swaps;
    expect(first?.a.id).toBe('S1');
    expect(first?.b.id).toBe('S2');
  });

  it('allows swaps that preserve an eight-hour rest window', async () => {
    const dataset: Dataset = {
      residents: [
        {
          id: 'R1',
          name: 'Resident One',
          eligibleShiftTypes: ['MOSES', 'NIGHT FLOAT'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'R2',
          name: 'Resident Two',
          eligibleShiftTypes: ['MOSES', 'NIGHT FLOAT'],
          rotations: [],
          academicYears: [],
        },
      ],
      shifts: [
        {
          id: 'S1',
          residentId: 'R1',
          startISO: '2025-01-13T17:00:00Z',
          endISO: '2025-01-13T22:00:00Z',
          type: 'MOSES',
          location: 'Unit A',
        },
        {
          id: 'S1_FOLLOW',
          residentId: 'R1',
          startISO: '2025-01-17T17:00:00Z',
          endISO: '2025-01-17T22:00:00Z',
          type: 'MOSES',
          location: 'Unit A',
        },
        {
          id: 'S2',
          residentId: 'R2',
          startISO: '2025-01-15T17:00:00Z',
          endISO: '2025-01-15T22:00:00Z',
          type: 'MOSES',
          location: 'Unit B',
        },
        {
          id: 'S2_NF',
          residentId: 'R2',
          startISO: '2025-01-11T22:00:00Z',
          endISO: '2025-01-12T09:00:00Z',
          type: 'NIGHT FLOAT',
          location: 'Unit Night',
        },
      ],
    };

    const target = dataset.shifts.find((shift) => shift.id === 'S1');
    expect(target).toBeDefined();
    if (!target) return;

    const { accepted: swaps } = await findSwapsForShift(dataset, target, {
      today: '2024-12-31T12:00:00Z',
    });
    expect(swaps.length).toBeGreaterThan(0);
  });

  it('does not allow swapping between Moses Junior and Moses Senior shifts', async () => {
    const dataset: Dataset = {
      residents: [
        {
          id: 'JR',
          name: 'Moses Junior Resident',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'SR',
          name: 'Moses Senior Resident',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'ALT',
          name: 'Alex Alternate',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
      ],
      shifts: [
        {
          id: 'JR_SHIFT',
          residentId: 'JR',
          startISO: '2025-02-01T17:00:00Z',
          endISO: '2025-02-02T05:00:00Z',
          type: 'MOSES',
          location: 'Moses Junior',
        },
        {
          id: 'SR_SHIFT',
          residentId: 'SR',
          startISO: '2025-02-05T17:00:00Z',
          endISO: '2025-02-06T05:00:00Z',
          type: 'MOSES',
          location: 'Moses Senior',
        },
        {
          id: 'ALT_SHIFT',
          residentId: 'ALT',
          startISO: '2025-02-08T17:00:00Z',
          endISO: '2025-02-09T05:00:00Z',
          type: 'MOSES',
          location: 'Moses Junior',
        },
      ],
    };

    const target = dataset.shifts.find((shift) => shift.id === 'JR_SHIFT');
    expect(target).toBeDefined();
    if (!target) return;

    const { accepted: swaps } = await findSwapsForShift(dataset, target, {
      today: '2025-01-31T12:00:00Z',
    });
    const swapIds = swaps.map((candidate) => candidate.b.id);
    expect(swapIds).not.toContain('SR_SHIFT');
    expect(swapIds).toContain('ALT_SHIFT');
  });

  it('finds swaps for parsed grid dataset sample', async () => {
    const csv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float,IR,Chief
2024-10-01,Tuesday,Jane Resident / Jamie Fellow,John Resident,Pat Lee,Alex Primary,Backup Buddy,Night Owl,IR Person,Chief Person
2024-10-02,Wednesday,Sam Smith,Pat Jones (Precept),Riley Stone / Casey Mesa,, , ,IR Person,Chief Person`;

    const dataset = parseCsvToDataset(csv);
    const target = dataset.shifts.find((shift) => shift.id === '2024-10-01_MOSES_JR');
    expect(target).toBeDefined();
    if (!target) return;

    const { accepted: swaps } = await findSwapsForShift(dataset, target, {
      today: '2024-09-30T12:00:00Z',
    });
    expect(swaps.length).toBeGreaterThan(0);
  });

  it('ignores swap candidates scheduled before today', async () => {
    const dataset: Dataset = {
      residents: [
        {
          id: 'R1',
          name: 'Resident One',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'R2',
          name: 'Resident Two',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'R3',
          name: 'Resident Three',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
      ],
      shifts: [
        {
          id: 'TARGET_FUTURE',
          residentId: 'R1',
          startISO: '2025-01-06T08:00:00Z',
          endISO: '2025-01-06T20:00:00Z',
          type: 'MOSES',
        },
        {
          id: 'PAST_SHIFT',
          residentId: 'R2',
          startISO: '2024-12-15T08:00:00Z',
          endISO: '2024-12-15T20:00:00Z',
          type: 'MOSES',
        },
        {
          id: 'FUTURE_SHIFT',
          residentId: 'R3',
          startISO: '2025-01-08T08:00:00Z',
          endISO: '2025-01-08T20:00:00Z',
          type: 'MOSES',
        },
      ],
    };

    const target = dataset.shifts.find((shift) => shift.id === 'TARGET_FUTURE');
    expect(target).toBeDefined();
    if (!target) return;

    const { accepted: swaps } = await findSwapsForShift(dataset, target, {
      today: '2025-01-01T00:00:00Z',
    });
    const partnerIds = swaps.map((swap) => swap.b.id);
    expect(partnerIds).toContain('FUTURE_SHIFT');
    expect(partnerIds).not.toContain('PAST_SHIFT');
  });

  it('returns no swaps when the target shift is already in the past', async () => {
    const dataset: Dataset = {
      residents: [
        {
          id: 'R1',
          name: 'Resident One',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'R2',
          name: 'Resident Two',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
      ],
      shifts: [
        {
          id: 'TARGET_PAST',
          residentId: 'R1',
          startISO: '2024-12-15T08:00:00Z',
          endISO: '2024-12-15T20:00:00Z',
          type: 'MOSES',
        },
        {
          id: 'FUTURE_SHIFT',
          residentId: 'R2',
          startISO: '2025-01-10T08:00:00Z',
          endISO: '2025-01-10T20:00:00Z',
          type: 'MOSES',
        },
      ],
    };

    const target = dataset.shifts.find((shift) => shift.id === 'TARGET_PAST');
    expect(target).toBeDefined();
    if (!target) return;

    const { accepted: swaps } = await findSwapsForShift(dataset, target, {
      today: '2024-12-31T00:00:00Z',
    });
    expect(swaps).toHaveLength(0);
  });

  it('returns no best swaps when resident has no primary shifts', async () => {
    const dataset: Dataset = {
      residents: [
        {
          id: 'R1',
          name: 'Resident One',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
      ],
      shifts: [
        {
          id: 'OTHER_SHIFT',
          residentId: 'R2',
          startISO: '2025-02-01T08:00:00Z',
          endISO: '2025-02-01T20:00:00Z',
          type: 'MOSES',
          location: 'Unit A',
        },
      ],
    };

    const result = await findBestSwaps(dataset, 'R1', {
      today: '2025-01-01T00:00:00Z',
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
  });

  it('ignores backup shifts when finding best swaps', async () => {
    const dataset: Dataset = {
      residents: [
        {
          id: 'R1',
          name: 'Resident One',
          eligibleShiftTypes: ['MOSES', 'BACKUP'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'R2',
          name: 'Resident Two',
          eligibleShiftTypes: ['MOSES', 'BACKUP'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'R3',
          name: 'Resident Three',
          eligibleShiftTypes: ['BACKUP'],
          rotations: [],
          academicYears: [],
        },
      ],
      shifts: [
        {
          id: 'PRIMARY_BACKUP',
          residentId: 'R1',
          startISO: '2025-03-01T08:00:00Z',
          endISO: '2025-03-01T20:00:00Z',
          type: 'BACKUP',
          location: 'Support',
        },
        {
          id: 'PRIMARY_DAY',
          residentId: 'R1',
          startISO: '2025-03-10T08:00:00Z',
          endISO: '2025-03-10T20:00:00Z',
          type: 'MOSES',
          location: 'Unit A',
        },
        {
          id: 'COUNTERPART_DAY',
          residentId: 'R2',
          startISO: '2025-03-10T08:00:00Z',
          endISO: '2025-03-10T20:00:00Z',
          type: 'MOSES',
          location: 'Unit A',
        },
        {
          id: 'COUNTERPART_BACKUP',
          residentId: 'R3',
          startISO: '2025-03-15T08:00:00Z',
          endISO: '2025-03-15T20:00:00Z',
          type: 'BACKUP',
          location: 'Support',
        },
      ],
    };

    const capturedPairs: ShiftPair[][] = [];
    const evaluateSpy = vi.spyOn(workerPool, 'evaluatePairs').mockImplementation(async (pairs) => {
      capturedPairs.push(pairs);
      return [];
    });

    const result = await findBestSwaps(dataset, 'R1', {
      today: '2025-03-01T00:00:00Z',
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(evaluateSpy).toHaveBeenCalledTimes(1);
    const [pairs] = capturedPairs;
    expect(pairs).toBeDefined();
    expect(pairs?.length).toBe(1);
    expect(pairs?.every((pair) => pair.a.type !== 'BACKUP' && pair.b.type !== 'BACKUP')).toBe(true);
    expect(pairs?.[0]?.a.id).toBe('PRIMARY_DAY');
    expect(pairs?.[0]?.b.id).toBe('COUNTERPART_DAY');

    evaluateSpy.mockRestore();
  });

  it('summarizes rejection reasons when no best swaps are feasible', async () => {
    const schedule: Dataset = {
      residents: [
        {
          id: 'R1',
          name: 'Resident One',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'R2',
          name: 'Resident Two',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'R3',
          name: 'Resident Three',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'R4',
          name: 'Resident Four',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
        {
          id: 'R5',
          name: 'Resident Five',
          eligibleShiftTypes: ['MOSES'],
          rotations: [],
          academicYears: [],
        },
      ],
      shifts: [
        {
          id: 'PRIMARY_A',
          residentId: 'R1',
          startISO: '2025-02-10T08:00:00Z',
          endISO: '2025-02-10T18:00:00Z',
          type: 'MOSES',
          location: 'Unit A',
        },
        {
          id: 'PRIMARY_B',
          residentId: 'R1',
          startISO: '2025-02-20T08:00:00Z',
          endISO: '2025-02-20T18:00:00Z',
          type: 'MOSES',
          location: 'Unit B',
        },
        {
          id: 'PRIMARY_C',
          residentId: 'R1',
          startISO: '2025-02-25T08:00:00Z',
          endISO: '2025-02-25T18:00:00Z',
          type: 'MOSES',
          location: 'Unit C',
        },
        {
          id: 'COUNTER_A',
          residentId: 'R2',
          startISO: '2025-02-12T08:00:00Z',
          endISO: '2025-02-12T18:00:00Z',
          type: 'MOSES',
          location: 'Unit A',
        },
        {
          id: 'COUNTER_B',
          residentId: 'R3',
          startISO: '2025-02-22T08:00:00Z',
          endISO: '2025-02-22T18:00:00Z',
          type: 'MOSES',
          location: 'Unit B',
        },
        {
          id: 'COUNTER_C',
          residentId: 'R4',
          startISO: '2025-02-14T08:00:00Z',
          endISO: '2025-02-14T18:00:00Z',
          type: 'MOSES',
          location: 'Unit C',
        },
        {
          id: 'COUNTER_D',
          residentId: 'R5',
          startISO: '2025-02-26T08:00:00Z',
          endISO: '2025-02-26T18:00:00Z',
          type: 'MOSES',
          location: 'Unit D',
        },
      ],
    };

    const evaluateSpy = vi.spyOn(workerPool, 'evaluatePairs').mockResolvedValue([]);

    const reasonFactories: Array<(a: Shift, b: Shift) => rules.SwapRejectionReason> = [
      (a, b) => ({ kind: 'same-resident', residentId: a.residentId, shiftA: a.id, shiftB: b.id }),
      (a, b) => ({
        kind: 'rule-violation',
        code: 'OVERLAP',
        message: 'overlap',
        residentId: a.residentId,
        shiftA: a.id,
        shiftB: b.id,
      }),
      (a, b) => ({ kind: 'unexpected-error', message: 'boom', shiftA: a.id, shiftB: b.id }),
      (a, b) => ({
        kind: 'eligibility-a',
        residentId: a.residentId,
        attemptedType: b.type,
        eligibleTypes: ['BACKUP'],
        shiftA: a.id,
        shiftB: b.id,
      }),
      (a, b) => ({
        kind: 'eligibility-b',
        residentId: b.residentId,
        attemptedType: a.type,
        eligibleTypes: ['MOSES'],
        shiftA: a.id,
        shiftB: b.id,
      }),
      (a, b) => ({
        kind: 'type-whitelist',
        whitelist: ['WEILER', 'BACKUP'],
        shiftA: { id: a.id, type: a.type },
        shiftB: { id: b.id, type: b.type },
      }),
      (a, b) => ({
        kind: 'moses-tier-mismatch',
        shiftA: a.id,
        shiftB: b.id,
        tierA: 'junior',
        tierB: 'senior',
      }),
      (a, b) => ({
        kind: 'resident-missing',
        residentA: a.residentId,
        residentB: b.residentId,
        shiftA: a.id,
        shiftB: b.id,
      }),
      (a, b) => ({ kind: 'missing-input', shiftA: a.id, shiftB: b.id }),
      (a) => ({ kind: 'identical-shift', shiftId: a.id }),
      (a, _b) => ({
        kind: 'vacation-conflict',
        residentId: a.residentId,
        shiftId: a.id,
        conflictDates: ['2025-02-14', '2025-02-15'],
      }),
      (a, _b) => ({
        kind: 'shabbos-restriction',
        residentId: a.residentId,
        shiftId: a.id,
        restriction: 'observer-night-float',
        shiftType: a.type,
        shiftStartISO: a.startISO,
      }),
      (a, b) => ({
        kind: 'weekend-mismatch',
        shiftA: a.id,
        shiftB: b.id,
        weekendOrHolidayA: false,
        weekendOrHolidayB: true,
      }),
    ];

    let callIndex = 0;
    const explainSpy = vi.spyOn(rules, 'explainSwap').mockImplementation((a, b) => {
      const factory = reasonFactories[callIndex % reasonFactories.length]!;
      callIndex += 1;
      return { feasible: false, reason: factory(a, b) };
    });

    const debugSpy = vi.spyOn(debug, 'debugLog').mockImplementation(() => {});

    const result = await findBestSwaps(schedule, 'R1', {
      today: '2025-02-01T00:00:00Z',
    });

    expect(result.accepted).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(evaluateSpy).toHaveBeenCalled();
    expect(debugSpy).toHaveBeenCalledWith(
      'findBestSwaps:rejections',
      expect.objectContaining({
        totalPairs: expect.any(Number),
      }),
    );

    evaluateSpy.mockRestore();
    explainSpy.mockRestore();
    debugSpy.mockRestore();
  });
});
