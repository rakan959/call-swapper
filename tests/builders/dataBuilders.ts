import fc from 'fast-check';
import { Dataset, Resident, Shift, ShiftType, SHIFT_TYPES } from '../../src/domain/types';

const shiftTypeArb = fc.constantFrom<ShiftType>(...SHIFT_TYPES);

type ResidentDraft = {
  id: string;
  name: string;
  eligibleShiftTypes: ShiftType[];
};

type ShiftDraft = {
  id: string;
  type: ShiftType;
  startOffset: number;
  duration: number;
};

export function residentArb(): fc.Arbitrary<Resident> {
  return fc
    .record<ResidentDraft>({
      id: fc.string({ minLength: 1, maxLength: 6 }),
      name: fc.string({ minLength: 1, maxLength: 12 }),
      eligibleShiftTypes: fc.uniqueArray(shiftTypeArb, {
        minLength: 1,
        maxLength: SHIFT_TYPES.length,
      }),
    })
    .map((resident: ResidentDraft) => ({
      ...resident,
      eligibleShiftTypes: [...resident.eligibleShiftTypes],
      rotations: [],
      academicYears: [],
    }));
}

export function shiftArb(residents: Resident[]): fc.Arbitrary<Shift> {
  return fc.constantFrom<Resident>(...residents).chain((owner: Resident) =>
    fc
      .record<ShiftDraft>({
        id: fc.string({ minLength: 1, maxLength: 8 }),
        type: fc.constantFrom<ShiftType>(...owner.eligibleShiftTypes),
        startOffset: fc.integer({ min: 0, max: 24 * 30 - 12 }),
        duration: fc.constantFrom(8, 10, 12),
      })
      .map(({ id, type, startOffset, duration }: ShiftDraft) => {
        const start = new Date(Date.UTC(2025, 9, 1, 0, 0, 0));
        start.setHours(start.getHours() + startOffset);
        const end = new Date(start);
        end.setHours(end.getHours() + duration);
        const shift: Shift = {
          id,
          residentId: owner.id,
          startISO: start.toISOString(),
          endISO: end.toISOString(),
          type,
        };
        return shift;
      }),
  );
}

export function datasetArb(): fc.Arbitrary<Dataset> {
  return fc
    .integer({ min: 2, max: 6 })
    .chain((nResidents: number) =>
      fc.tuple(
        fc.uniqueArray(residentArb(), { minLength: nResidents, maxLength: nResidents }),
        fc.integer({ min: 2, max: 40 }),
      ),
    )
    .chain(([residents, nShifts]: [Resident[], number]) =>
      fc
        .uniqueArray(shiftArb(residents), {
          minLength: nShifts,
          maxLength: nShifts,
        })
        .map((shifts: Shift[]) => ({
          residents,
          shifts,
        })),
    );
}

export const buildDatasetArb = datasetArb;
