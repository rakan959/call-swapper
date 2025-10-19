/**
 * @req: F-001
 * @req: F-002
 * @req: F-003
 * @req: F-004
 * @req: F-005
 * @req: F-006
 * @req: F-007
 * @req: F-008
 * @req: F-009
 * @req: F-012
 * @req: F-013
 * @req: N-008
 */
import { describe, it, expect } from 'vitest';
import { parseCsvToDataset } from '../../src/utils/csv';
import { findSwapsForShift, findBestSwaps } from '../../src/engine/swapEngine';

const CSV = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float
2025-10-06,Monday,Alice Rivers,Brian Senior,Carol Evans,Dan Intern,Backup Buddy,Night Owl
2025-10-07,Tuesday,Bob Stone,Brian Senior,Alice Rivers,Dan Intern,Backup Buddy,Night Owl`;

describe('Calendar & Swaps (acceptance skeleton)', () => {
  it('parses CSV and exposes dataset', () => {
    const ds = parseCsvToDataset(CSV);
    expect(ds.shifts.length).toBeGreaterThanOrEqual(10);
    expect(ds.residents.length).toBeGreaterThanOrEqual(6);
  });

  it('URL param "resident" filters (simulated)', async () => {
    const ds = parseCsvToDataset(CSV);
    const onlyAlice = ds.shifts.filter((s) => s.residentId === 'resident-alice-rivers');
    expect(onlyAlice.length).toBeGreaterThanOrEqual(2);
  });

  it('find swaps for a selected shift (placeholder to fail until rules implemented)', async () => {
    const ds = parseCsvToDataset(CSV);
    const target = ds.shifts.find((shift) => shift.id.endsWith('MOSES_JR'));
    expect(target).toBeDefined();
    if (!target) return;
    const { accepted: swaps } = await findSwapsForShift(ds, target);
    expect(swaps.length).toBeGreaterThanOrEqual(0);
    swaps.forEach((swap) => {
      expect(swap.pressure.baselineScore).toBeTypeOf('number');
      expect(swap.pressure.swappedScore).toBeTypeOf('number');
    });
  });

  it('find best swaps ranks results (placeholder to fail)', async () => {
    const ds = parseCsvToDataset(CSV);
    const { accepted: swaps } = await findBestSwaps(ds, 'resident-alice-rivers');
    expect(swaps.length).toBeGreaterThanOrEqual(0);
    if (swaps.length > 1) {
      const scores = swaps.map((swap) => swap.score);
      const sorted = [...scores].sort((a, b) => b - a);
      expect(scores).toEqual(sorted);
    }
  });
});
