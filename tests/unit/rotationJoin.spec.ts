import { describe, it, expect, vi } from 'vitest';
import { attachRotationsBySurname } from '../../src/utils/rotationJoin';
import type {
  Resident,
  RotationAssignment,
  ResidentAcademicYearAssignment,
} from '../../src/domain/types';

const resident = (id: string, name: string): Resident => ({
  id,
  name,
  eligibleShiftTypes: ['MOSES'],
  rotations: [],
  academicYears: [],
});
const rot = (weekStartISO: string, rotation: string): RotationAssignment => ({
  weekStartISO,
  rotation,
  rawRotation: rotation,
  vacationDates: [],
});
const ay = (iso: string, label: string): ResidentAcademicYearAssignment => ({
  academicYearStartISO: iso,
  label,
});

describe('attachRotationsBySurname', () => {
  it('joins surname call ids to full-name rotation ids', () => {
    const residents = [
      resident('resident-bains', 'Bains'),
      resident('resident-al-qaqa-a', "Al-Qaqa'a"),
    ];
    const rotations = new Map([
      ['resident-henrietta-bains', [rot('2026-06-29T00:00:00.000Z', 'GI')]],
      ['resident-rakan-al-qaqa-a', [rot('2026-06-29T00:00:00.000Z', 'Angio')]],
    ]);
    const academicYears = new Map([
      ['resident-henrietta-bains', [ay('2026-07-01T00:00:00.000Z', 'R1')]],
      ['resident-rakan-al-qaqa-a', [ay('2026-07-01T00:00:00.000Z', 'R4')]],
    ]);
    const displayNames = new Map([
      ['resident-henrietta-bains', 'Henrietta Bains'],
      ['resident-rakan-al-qaqa-a', "Rakan Al-Qaqa'a"],
    ]);

    const out = attachRotationsBySurname(residents, rotations, academicYears, displayNames);
    expect(out.find((r) => r.id === 'resident-bains')!.rotations[0]!.rotation).toBe('GI');
    expect(out.find((r) => r.id === 'resident-bains')!.academicYears[0]!.label).toBe('R1');
    expect(out.find((r) => r.id === 'resident-al-qaqa-a')!.rotations[0]!.rotation).toBe('Angio');
  });

  it('skips ambiguous surnames and warns; leaves residents unmatched empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const residents = [resident('resident-smith', 'Smith')];
    const rotations = new Map([
      ['resident-john-smith', [rot('2026-06-29T00:00:00.000Z', 'GI')]],
      ['resident-jane-smith', [rot('2026-06-29T00:00:00.000Z', 'US')]],
    ]);
    const out = attachRotationsBySurname(
      residents,
      rotations,
      new Map(),
      new Map([
        ['resident-john-smith', 'John Smith'],
        ['resident-jane-smith', 'Jane Smith'],
      ]),
    );
    expect(out[0]!.rotations).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
