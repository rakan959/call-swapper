// tests/unit/rotations.displayNames.spec.ts
import { describe, it, expect } from 'vitest';
import { parseRotationCsv } from '../../src/utils/rotations';

describe('parseRotationCsv displayNamesById', () => {
  it('maps canonical id -> original full name', () => {
    const csv = [
      '"R1","6/29/2026","7/6/2026"',
      '"Henrietta Bains","Radiology 101","GI"',
      '"Rakan Al-Qaqa\'a","US","Angio"',
    ].join('\n');
    const { displayNamesById } = parseRotationCsv(csv);
    expect(displayNamesById.get('resident-henrietta-bains')).toBe('Henrietta Bains');
    expect(displayNamesById.get('resident-rakan-al-qaqa-a')).toBe("Rakan Al-Qaqa'a");
  });
});
