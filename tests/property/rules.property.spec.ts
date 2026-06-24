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

  // --- SCORE_BOUND: the maximum |proximityPressure| achievable over buildDatasetArb() ---
  //
  // calculateSwapPressure() (src/domain/simipar.ts) composes the score as:
  //   score = MULT × (deltaOriginalSection + deltaCounterpartSection)  // rest-pressure + extras, scaled
  //         + ipConsultPenalty                                         // flat, added AFTER scaling
  //         + Σ rotationDeltas                                         // flat, added AFTER scaling
  //
  // MULT = SCORE_SCALE × shiftMult(a) × shiftMult(b), with shiftMult ∈ {1, 2, 4}
  //   (BACKUP → 1; weekend/holiday XOR night-float → 2; both → 4), so MULT ≤ 100 × 4 × 4 = 1600.
  //
  // Each section's UNSCALED delta = (normalized rest-pressure delta) + (extras delta):
  //   • normalized delta ∈ [−1, 1]: baselineTotal/swappedTotal are weight-normalized averages of
  //     per-call penalties ∈ [−1, 0], so each lands in [−1, 0] ⇒ their difference is in [−1, 1].
  //   • extras delta is the baseline↔swapped swing of the raw (pre-scale) chain + weekend penalties:
  //       chain   penalty = 0.25 × (chainDays − 3),   weekend penalty = 0.4 × (weekendWeeks − 1).
  //     The generator confines every shift to one ~30-day window (startOffset ≤ 24*30−12), so a
  //     resident spans ≤ 30 distinct call-days and ≤ 6 weekend-weeks ⇒
  //       chain ≤ 0.25 × (30 − 3) = 6.75,  weekend ≤ 0.4 × (6 − 1) = 2.0  ⇒ |extras| ≤ 8.75/section.
  //   ⇒ |section delta| ≤ 1 + 8.75 = 9.75, and the two-section sum ≤ 2 × 9.75 = 19.5.
  //
  // ipConsultPenalty ∈ {−50, 0} ⇒ ≤ 50.   rotationDeltas: ≤ 4 calls × 100 ⇒ ≤ 400.
  // (The generator leaves rotations empty and never marks Moses-Senior shifts, so those two terms
  //  are 0 in practice; they are retained so the bound stays valid if the generator is extended.)
  //
  //   SCORE_BOUND = 1600 × 19.5 + 50 + 400 = 31_650.
  //
  // The earlier value (SCORE_SCALE × 4 × 4 = 1600) was wrong: it assumed the unscaled score sat in
  // [−1, 1], but the score SUMS two section deltas (→ [−2, 2]) and the extras add un-normalized,
  // pre-scale penalties — so |score| could reach ~2264 on random input, making the test ~50% flaky.
  const SCORE_SCALE = 100;
  const SHIFT_MULTIPLIER_MAX = 4; // weekend/holiday and night float combined cap at 4x
  const MULT_MAX = SCORE_SCALE * SHIFT_MULTIPLIER_MAX * SHIFT_MULTIPLIER_MAX; // 1600
  const CHAIN_EXTRA_MAX = 0.25 * (30 - 3); // 6.75 — chain penalty over a 30-day window
  const WEEKEND_EXTRA_MAX = 0.4 * (6 - 1); // 2.0 — weekend-streak penalty over a 30-day window
  const SECTION_DELTA_MAX = 1 + CHAIN_EXTRA_MAX + WEEKEND_EXTRA_MAX; // 9.75 (normalized + extras)
  const IP_CONSULT_PENALTY_MAX = 50;
  const ROTATION_BONUS_MAX = 4 * 100; // 400 (≤ 4 rotation calls × ROTATION_PRESSURE_BONUS)
  const SCORE_BOUND =
    MULT_MAX * (2 * SECTION_DELTA_MAX) + IP_CONSULT_PENALTY_MAX + ROTATION_BONUS_MAX; // 31_650

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
        expect(Number.isFinite(s1)).toBe(true);
        expect(s1).toBeGreaterThanOrEqual(-SCORE_BOUND);
        expect(s1).toBeLessThanOrEqual(SCORE_BOUND);
        return s1 === s2;
      }),
    );
  });

  it('idempotent parsing for identical CSV', () => {
    // Placeholder; property will compare parseCsvToDataset(csv) twice for equality.
    expect(true).toBe(true);
  });
});
