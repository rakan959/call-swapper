/**
 * @req: F-004
 * @req: F-013
 */
import { describe, it, expect } from 'vitest';
import {
  filterShiftsByResident,
  isValidResidentId,
  nextResidentSearch,
} from '../../src/domain/residentFilter';
import type { Resident, Shift } from '../../src/domain/types';

describe('resident filter utilities', () => {
  const residents: Resident[] = [
    {
      id: 'R1',
      name: 'Alice',
      eligibleShiftTypes: ['MOSES'],
      rotations: [],
      academicYears: [],
    },
    {
      id: 'R2',
      name: 'Bob',
      eligibleShiftTypes: ['MOSES', 'WEILER'],
      rotations: [],
      academicYears: [],
    },
  ];

  const shifts: Shift[] = [
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
      type: 'WEILER',
    },
  ];

  it('returns all shifts when no resident filter is applied', () => {
    const result = filterShiftsByResident(shifts, null);
    expect(result).toHaveLength(2);
  });

  it('filters shifts by matching resident id', () => {
    const result = filterShiftsByResident(shifts, 'R1');
    expect(result).toEqual([shifts[0]]);
  });

  it('rejects invalid resident ids', () => {
    expect(isValidResidentId(residents, 'R3')).toBe(false);
    expect(isValidResidentId(residents, null)).toBe(true);
  });

  it('builds search string with resident id while preserving other params', () => {
    const search = nextResidentSearch('?view=week&resident=old', 'R2');
    expect(search).toBe('?view=week&resident=R2');
  });

  it('removes resident param when filter cleared', () => {
    const search = nextResidentSearch('?resident=R1&foo=bar', null);
    expect(search).toBe('?foo=bar');
  });
});
