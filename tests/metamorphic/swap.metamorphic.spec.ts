/**
 * @req: F-007
 * @req: F-001
 * @req: F-011
 */
import { describe, it, expect } from 'vitest';
import { Context, Dataset, Shift, ShiftType } from '../../src/domain/types';
import { resolveShabbosObservers } from '../../src/domain/shabbos';
import { isFeasibleSwap } from '../../src/domain/rules';
function buildContext(dataset: Dataset): Context {
  const residentsById = new Map(dataset.residents.map((resident) => [resident.id, resident]));
  const shiftsByResident = new Map<string, Shift[]>();
  for (const shift of dataset.shifts) {
    const list = shiftsByResident.get(shift.residentId) ?? [];
    list.push(shift);
    shiftsByResident.set(shift.residentId, list);
  }
  for (const list of shiftsByResident.values()) {
    list.sort((a, b) => a.startISO.localeCompare(b.startISO));
  }
  const typeWhitelist = Array.from(
    new Set<ShiftType>(dataset.shifts.map((shift: Shift) => shift.type)),
  );
  return {
    residentsById,
    shiftsByResident,
    ruleConfig: {
      restHoursMin: 10,
      typeWhitelist,
    },
    shabbosObservers: resolveShabbosObservers(shiftsByResident),
  };
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

describe('Metamorphic swap invariants (skeleton)', () => {
  it('adding unrelated shift does not change feasibility', () => {
    const ds: Dataset = {
      residents: [
        { id: 'R1', name: 'A', eligibleShiftTypes: ['MOSES'], rotations: [], academicYears: [] },
        { id: 'R2', name: 'B', eligibleShiftTypes: ['MOSES'], rotations: [], academicYears: [] },
      ],
      shifts: [
        {
          id: 'S1',
          residentId: 'R1',
          startISO: '2025-10-01T08:00:00Z',
          endISO: '2025-10-01T20:00:00Z',
          type: 'MOSES',
        },
        {
          id: 'S2',
          residentId: 'R2',
          startISO: '2025-10-02T08:00:00Z',
          endISO: '2025-10-02T20:00:00Z',
          type: 'MOSES',
        },
      ],
    };
    const a = ds.shifts[0]!;
    const b = ds.shifts[1]!;
    const ctx = buildContext(ds);
    const before = isFeasibleSwap(a, b, ctx);

    const ds2 = clone(ds);
    const unrelated: Shift = {
      id: 'SX',
      residentId: 'R2',
      startISO: '2025-11-01T08:00:00Z',
      endISO: '2025-11-01T20:00:00Z',
      type: 'MOSES',
    };
    ds2.shifts.push(unrelated);
    const ctx2 = buildContext(ds2);
    const after = isFeasibleSwap(a, b, ctx2);
    expect(before).toBe(after);
  });
});
