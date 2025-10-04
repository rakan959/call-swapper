import { describe, expect, it, vi } from 'vitest';
import type { RotationAssignment } from '../../src/domain/types';
import {
  findRotationForDate,
  parseRotationCsv,
  RotationCsvValidationError,
} from '../../src/utils/rotations';

describe('parseRotationCsv', () => {
  it('parses weekly rotation assignments by resident', () => {
    const csv = [
      '"R1","7/1/2024","7/8/2024","7/15/2024"',
      '"Alice","Chest","Night Float","Vacation"',
      '"Bob","Research","Chest",""',
      '"R2","7/1/2024","7/8/2024","7/15/2024"',
      '"Charlie","Night Float","Chest","Research"',
    ].join('\n');

    const result = parseRotationCsv(csv);

    expect(result.rotations.size).toBe(3);

    const alice = result.rotations.get('resident-alice');
    expect(alice).toEqual([
      {
        weekStartISO: '2024-07-01T00:00:00.000Z',
        rotation: 'Chest',
        rawRotation: 'Chest',
        vacationDates: [],
      },
      {
        weekStartISO: '2024-07-08T00:00:00.000Z',
        rotation: 'Night Float',
        rawRotation: 'Night Float',
        vacationDates: [],
      },
      {
        weekStartISO: '2024-07-15T00:00:00.000Z',
        rotation: 'Vacation',
        rawRotation: 'Vacation',
        vacationDates: [],
      },
    ]);

    const bob = result.rotations.get('resident-bob');
    expect(bob).toEqual([
      {
        weekStartISO: '2024-07-01T00:00:00.000Z',
        rotation: 'Research',
        rawRotation: 'Research',
        vacationDates: [],
      },
      {
        weekStartISO: '2024-07-08T00:00:00.000Z',
        rotation: 'Chest',
        rawRotation: 'Chest',
        vacationDates: [],
      },
    ]);

    const charlie = result.rotations.get('resident-charlie');
    expect(charlie).toEqual([
      {
        weekStartISO: '2024-07-01T00:00:00.000Z',
        rotation: 'Night Float',
        rawRotation: 'Night Float',
        vacationDates: [],
      },
      {
        weekStartISO: '2024-07-08T00:00:00.000Z',
        rotation: 'Chest',
        rawRotation: 'Chest',
        vacationDates: [],
      },
      {
        weekStartISO: '2024-07-15T00:00:00.000Z',
        rotation: 'Research',
        rawRotation: 'Research',
        vacationDates: [],
      },
    ]);

    expect(result.academicYears.get('resident-alice')).toEqual([
      {
        academicYearStartISO: '2024-07-01T00:00:00.000Z',
        label: 'R1',
      },
    ]);
    expect(result.academicYears.get('resident-charlie')).toEqual([
      {
        academicYearStartISO: '2024-07-01T00:00:00.000Z',
        label: 'R2',
      },
    ]);
  });

  it('raises a validation error when week starts are not Mondays', () => {
    const csv = ['"R1","7/3/2024"', '"Resident One","Chest"'].join('\n');

    expect(() => parseRotationCsv(csv)).toThrow(RotationCsvValidationError);
  });

  it('skips rotation rows without resident names', () => {
    const csv = ['"R1","7/1/2024"', '"Alice","Chest"', '"","Chest"', '"Bob","Night Float"'].join(
      '\n',
    );

    const result = parseRotationCsv(csv);

    expect(result.rotations.get('resident-alice')).toEqual([
      {
        weekStartISO: '2024-07-01T00:00:00.000Z',
        rotation: 'Chest',
        rawRotation: 'Chest',
        vacationDates: [],
      },
    ]);
    expect(result.rotations.get('resident-bob')).toEqual([
      {
        weekStartISO: '2024-07-01T00:00:00.000Z',
        rotation: 'Night Float',
        rawRotation: 'Night Float',
        vacationDates: [],
      },
    ]);
  });

  it('extracts vacation dates from rotation labels', () => {
    const csv = ['"R1","10/7/2024"', '"Alice","Chest (V 12–13)"'].join('\n');

    const result = parseRotationCsv(csv);

    expect(result.rotations.get('resident-alice')).toEqual([
      {
        weekStartISO: '2024-10-07T00:00:00.000Z',
        rotation: 'Chest',
        rawRotation: 'Chest (V 12–13)',
        vacationDates: ['2024-10-12', '2024-10-13'],
      },
    ]);
  });

  it('records academic year labels for each resident', () => {
    const csv = [
      '"R3","6/24/2024","7/1/2024"',
      '"Resident One","US","US"',
      '"R4 DR","7/1/2024"',
      '"Resident Two","Chest"',
      '"R4 IR","7/1/2024"',
      '"Resident Three","Angio"',
    ].join('\n');

    const result = parseRotationCsv(csv);

    expect(result.academicYears.get('resident-resident-one')).toEqual([
      {
        academicYearStartISO: '2023-07-01T00:00:00.000Z',
        label: 'R3',
      },
      {
        academicYearStartISO: '2024-07-01T00:00:00.000Z',
        label: 'R3',
      },
    ]);
    expect(result.academicYears.get('resident-resident-two')).toEqual([
      {
        academicYearStartISO: '2024-07-01T00:00:00.000Z',
        label: 'R4 DR',
      },
    ]);
    expect(result.academicYears.get('resident-resident-three')).toEqual([
      {
        academicYearStartISO: '2024-07-01T00:00:00.000Z',
        label: 'R4 IR',
      },
    ]);
  });

  it('ignores whitespace rows and deduplicates academic years for repeated residents', () => {
    const csv = [
      '"R1","7/1/2024","7/8/2024","7/15/2024"',
      '"   ","   ","   ","   "',
      '"Resident One","Chest","",""',
      '"Resident One","","Night Float","Vacation"',
      '"Resident Two","ICU","","Clinic"',
    ].join('\n');

    const result = parseRotationCsv(csv);

    expect(result.rotations.get('resident-resident-one')).toEqual([
      {
        weekStartISO: '2024-07-01T00:00:00.000Z',
        rotation: 'Chest',
        rawRotation: 'Chest',
        vacationDates: [],
      },
      {
        weekStartISO: '2024-07-08T00:00:00.000Z',
        rotation: 'Night Float',
        rawRotation: 'Night Float',
        vacationDates: [],
      },
      {
        weekStartISO: '2024-07-15T00:00:00.000Z',
        rotation: 'Vacation',
        rawRotation: 'Vacation',
        vacationDates: [],
      },
    ]);

    expect(result.academicYears.get('resident-resident-one')).toEqual([
      {
        academicYearStartISO: '2024-07-01T00:00:00.000Z',
        label: 'R1',
      },
    ]);
  });

  it('raises a validation error when resident ids cannot be derived', () => {
    const csv = ['"R1","7/1/2024"', '"!!!","Chest"'].join('\n');

    let thrown: unknown;
    try {
      parseRotationCsv(csv);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RotationCsvValidationError);
    const issues = (thrown as RotationCsvValidationError).issues;
    expect(issues).toEqual([
      {
        row: 2,
        column: 1,
        message: 'Unable to derive resident id from name "!!!"',
      },
    ]);
  });

  it('collects issues for invalid week starts in stacked headers', () => {
    const csv = [
      '"R1","7/1/2024",""',
      '"","7/8/2024","not a date"',
      '"Alice","Chest","Night Float"',
    ].join('\n');

    let thrown: unknown;
    try {
      parseRotationCsv(csv);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RotationCsvValidationError);
    const issues = (thrown as RotationCsvValidationError).issues;
    expect(issues).toContainEqual({
      row: 2,
      column: 2,
      message: 'Unable to parse week start date "not a date"',
    });
  });

  it('omits academic years when headers provide no week starts', () => {
    const csv = ['"R1",""', '"Alice",""'].join('\n');

    const result = parseRotationCsv(csv);

    expect(result.rotations.get('resident-alice')).toEqual([]);
    expect(result.academicYears.size).toBe(0);
  });

  it('extracts cross-month vacations and preserves non-vacation details', () => {
    const csv = ['"R1","7/29/2024"', '"Alice","Neuro (Clinic) (V 1-2) (Notes)"'].join('\n');

    const result = parseRotationCsv(csv);

    expect(result.rotations.get('resident-alice')).toEqual([
      {
        weekStartISO: '2024-07-29T00:00:00.000Z',
        rotation: 'Neuro (Clinic) (Notes)',
        rawRotation: 'Neuro (Clinic) (V 1-2) (Notes)',
        vacationDates: ['2024-08-01', '2024-08-02'],
      },
    ]);
  });

  it('ignores rotation cells when no week start header is provided', () => {
    const csv = [
      '"R1","7/1/2024","",""',
      '"","7/8/2024","",""',
      '"Resident One","Chest","Night Float","Elective"',
    ].join('\n');

    const result = parseRotationCsv(csv);

    expect(result.rotations.get('resident-resident-one')).toEqual([
      {
        weekStartISO: '2024-07-01T00:00:00.000Z',
        rotation: 'Chest',
        rawRotation: 'Chest',
        vacationDates: [],
      },
    ]);
    const rotations = result.rotations.get('resident-resident-one') ?? [];
    expect(rotations.some((assignment) => assignment.rotation === 'Night Float')).toBe(false);
  });

  it('surfaces parser errors without row numbers for rotation CSVs', async () => {
    vi.resetModules();
    vi.doMock('papaparse', () => ({
      default: {
        parse: () => ({
          data: [],
          meta: {},
          errors: [
            {
              type: 'Quotes',
              code: 'MissingQuotes',
              message: 'Rotation CSV malformed',
              row: null,
            },
          ],
        }),
      },
    }));

    const module = await import('../../src/utils/rotations');

    expect(() => module.parseRotationCsv('"R1"')).toThrow(module.RotationCsvValidationError);

    let thrown: unknown;
    try {
      module.parseRotationCsv('"R1"');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(module.RotationCsvValidationError);
    expect((thrown as InstanceType<typeof module.RotationCsvValidationError>).issues).toEqual([
      {
        row: 0,
        message: 'Rotation CSV malformed',
      },
    ]);

    vi.doUnmock('papaparse');
    vi.resetModules();
  });
});

describe('findRotationForDate', () => {
  it('returns null when provided iso date is invalid', () => {
    const assignments: RotationAssignment[] = [
      {
        weekStartISO: '2024-07-01T00:00:00.000Z',
        rotation: 'Chest',
        rawRotation: 'Chest',
        vacationDates: [],
      },
    ];

    expect(findRotationForDate(assignments, 'not-a-date')).toBeNull();
  });

  it('ignores assignments with invalid week starts', () => {
    const assignments: RotationAssignment[] = [
      {
        weekStartISO: 'not-a-date',
        rotation: 'Invalid',
        rawRotation: 'Invalid',
        vacationDates: [],
      },
      {
        weekStartISO: '2024-07-01T00:00:00.000Z',
        rotation: 'Chest',
        rawRotation: 'Chest',
        vacationDates: [],
      },
    ];

    const found = findRotationForDate(assignments, '2024-07-03');
    expect(found).toEqual({
      weekStartISO: '2024-07-01T00:00:00.000Z',
      rotation: 'Chest',
      rawRotation: 'Chest',
      vacationDates: [],
    });
  });
});
