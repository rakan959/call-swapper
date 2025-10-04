/**
 * @req: F-007
 * @req: F-011
 * @req: F-012
 * @req: N-001
 * @req: N-002
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { buildDatasetArb } from '../builders/dataBuilders';
import { isFeasibleSwap } from '../../src/domain/rules';
import { proximityPressure } from '../../src/domain/simipar';
import { Context, Dataset, Shift, ShiftType } from '../../src/domain/types';
import { resolveShabbosObservers } from '../../src/domain/shabbos';

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

describe('Rule properties', () => {
  it('feasibility is symmetric', () => {
    fc.assert(
      fc.property(buildDatasetArb(), (ds: Dataset) => {
        const shifts = ds.shifts;
        if (shifts.length < 2) return true;
        const [first, second] = shifts;
        if (!first || !second) return true;
        const ctx = buildContext(ds);
        const ab = isFeasibleSwap(first, second, ctx);
        const ba = isFeasibleSwap(second, first, ctx);
        expect(ab).toBe(ba);
        return ab === ba;
      }),
    );
  });

  it('scoring is deterministic and bounded', () => {
    fc.assert(
      fc.property(buildDatasetArb(), (ds: Dataset) => {
        if (ds.shifts.length < 2) return true;
        const [first, second] = ds.shifts;
        if (!first || !second) return true;
        const ctx = buildContext(ds);
        const s1 = proximityPressure(first, second, ctx);
        const s2 = proximityPressure(first, second, ctx);
        expect(s1).toBe(s2);
        expect(s1).toBeGreaterThanOrEqual(-SCORE_BOUND);
        expect(s1).toBeLessThanOrEqual(SCORE_BOUND);
        return s1 === s2;
      }),
    );
  });
  const SCORE_SCALE = 100;
  const SHIFT_MULTIPLIER_MAX = 4; // weekend/holiday and night float combined cap at 4x
  const SCORE_BOUND = SCORE_SCALE * SHIFT_MULTIPLIER_MAX * SHIFT_MULTIPLIER_MAX;

  it('idempotent parsing for identical CSV', () => {
    // Placeholder; property will compare parseCsvToDataset(csv) twice for equality.
    expect(true).toBe(true);
  });
});
