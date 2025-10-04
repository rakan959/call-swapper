import { describe, expect, it } from 'vitest';

import { DatasetValidationError, ResidentSchema, ShiftSchema, parseDataset } from '@domain/types';

const baseShift = {
  id: 'shift-1',
  residentId: 'resident-1',
  startISO: '2024-01-01T08:00:00.000Z',
  endISO: '2024-01-01T18:00:00.000Z',
  type: 'MOSES' as const,
};

const baseResident = {
  id: 'resident-1',
  name: 'Resident One',
  eligibleShiftTypes: ['MOSES'] as const,
};

describe('domain schema hardening', () => {
  it('rejects duplicate vacation dates for rotations', () => {
    expect(() =>
      ResidentSchema.parse({
        ...baseResident,
        rotations: [
          {
            weekStartISO: '2024-01-01T00:00:00.000Z',
            rotation: 'Rotation',
            rawRotation: 'Rotation',
            vacationDates: ['2024-01-05', '2024-01-05'],
          },
        ],
      }),
    ).toThrowError(/vacationDates must not contain duplicates/);
  });

  it('enforces strict object shape for shifts', () => {
    expect(() =>
      ShiftSchema.parse({
        ...baseShift,
        location: 'Moses',
        unexpected: 'value',
      } as Record<string, unknown>),
    ).toThrowError();
  });

  it('disallows extraneous fields on datasets', () => {
    expect(() =>
      parseDataset({
        residents: [baseResident],
        shifts: [
          {
            ...baseShift,
            location: 'Moses',
          },
        ],
        extra: [],
      }),
    ).toThrowError(DatasetValidationError);
  });
});
