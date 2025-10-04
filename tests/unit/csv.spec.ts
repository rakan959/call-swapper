/**
 * @req: F-001
 * @req: F-012
 */
import dayjs from '@utils/dayjs';
import { describe, it, expect, vi } from 'vitest';
import { parseCsvToDataset, CsvValidationError, canonicalizeResidentId } from '../../src/utils/csv';

describe('CSV ingestion', () => {
  it('parses the schedule grid format and splits composite assignments', () => {
    const gridCsv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float,IR,Chief
2024-10-01,Tuesday,Jane Resident / Jamie Fellow,John Resident,Pat Lee,Alex Primary,Backup Buddy,Night Owl,IR Person,Chief Person
2024-10-02,Wednesday,Sam Smith,Pat Jones (Precept),Riley Stone / Casey Mesa,, , ,IR Person,Chief Person`;

    const dataset = parseCsvToDataset(gridCsv);

    expect(dataset.shifts).toHaveLength(11);
    const sortedResidentNames = dataset.residents
      .map((resident) => resident.name)
      .sort((a, b) => a.localeCompare(b));
    expect(sortedResidentNames).toEqual([
      'Alex Primary',
      'Backup Buddy',
      'Casey Mesa',
      'Jamie Fellow',
      'Jane Resident',
      'John Resident',
      'Night Owl',
      'Pat Jones',
      'Pat Lee',
      'Riley Stone',
      'Sam Smith',
    ]);

    const mosesJuniorDayOne = dataset.shifts.filter((shift) =>
      shift.id.startsWith('2024-10-01_MOSES_JR'),
    );
    expect(mosesJuniorDayOne).toHaveLength(2);
    const mosesJuniorNames = mosesJuniorDayOne.map(
      (shift) => dataset.residents.find((resident) => resident.id === shift.residentId)?.name,
    );
    expect(mosesJuniorNames).toEqual(['Jane Resident', 'Jamie Fellow']);

    const weilerDayTwo = dataset.shifts.filter((shift) => shift.id.startsWith('2024-10-02_WEILER'));
    expect(weilerDayTwo).toHaveLength(2);
    const weilerNames = weilerDayTwo
      .map((shift) => dataset.residents.find((resident) => resident.id === shift.residentId)?.name)
      .filter((name): name is string => Boolean(name))
      .sort((a, b) => a.localeCompare(b));
    expect(weilerNames).toEqual(['Casey Mesa', 'Riley Stone']);

    const patJonesShift = dataset.shifts.find((shift) => shift.residentId === 'resident-pat-jones');
    expect(patJonesShift?.id).toBe('2024-10-02_MOSES_SR');

    const sampleShift = dataset.shifts.find((shift) => shift.id === '2024-10-01_MOSES_JR');
    expect(sampleShift).toBeDefined();
    if (sampleShift) {
      expect(
        dayjs(sampleShift.startISO).diff(dayjs(sampleShift.startISO).startOf('day'), 'hour'),
      ).toBe(17);
      expect(dayjs(sampleShift.endISO).diff(dayjs(sampleShift.startISO), 'hour')).toBe(5);
    }
  });

  it('strips UTF-8 BOM headers before parsing', () => {
    const csv = `\uFEFFDate,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float
2024-10-01,Tuesday,Resident One,Resident Two,Resident Three,,,,`;

    const dataset = parseCsvToDataset(csv);

    expect(dataset.shifts).toHaveLength(3);
  });

  it('parses files using CRLF line endings', () => {
    const csv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float\r\n2024-10-02,Wednesday,Resident One,Resident Two,Resident Three,,,,`;

    const dataset = parseCsvToDataset(csv);

    expect(dataset.shifts).toHaveLength(3);
  });

  it('ignores vacancy tokens and excluded columns in grid format', () => {
    const gridCsv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float,IR,Chief
2024-11-03,Sunday,OFF,VACATION,TBD,,N/A,OFF,IR Person,Chief Person`;

    const dataset = parseCsvToDataset(gridCsv);
    expect(dataset.shifts).toHaveLength(0);
    expect(dataset.residents).toHaveLength(0);
  });

  it('applies weekend-specific timing rules for shift types', () => {
    const gridCsv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float
2024-10-05,Saturday,Weekend Junior,Weekend Senior,Weekend Weiler,Weekend Consult,Weekend Backup,Weekend Night`;

    const dataset = parseCsvToDataset(gridCsv);
    expect(dataset.shifts).toHaveLength(6);

    const byId = new Map(dataset.shifts.map((shift) => [shift.id, shift]));

    const expectations: Array<{ id: string; startHour: number; durationHours: number }> = [
      { id: '2024-10-05_MOSES_JR', startHour: 9, durationHours: 13 },
      { id: '2024-10-05_MOSES_SR', startHour: 9, durationHours: 13 },
      { id: '2024-10-05_WEILER', startHour: 13, durationHours: 8 },
      { id: '2024-10-05_IP_CONSULT', startHour: 9, durationHours: 13 },
      { id: '2024-10-05_BACKUP', startHour: 9, durationHours: 24 },
      { id: '2024-10-05_NIGHT_FLOAT', startHour: 22, durationHours: 11 },
    ];

    for (const { id, startHour, durationHours } of expectations) {
      const shift = byId.get(id);
      expect(shift, `Missing shift ${id}`).toBeDefined();
      if (!shift) continue;
      const start = dayjs(shift.startISO);
      const end = dayjs(shift.endISO);
      expect(start.diff(start.startOf('day'), 'hour')).toBe(startHour);
      expect(end.diff(start, 'hour')).toBe(durationHours);
    }
  });

  it('treats observed holidays like weekends when scheduling shifts', () => {
    const gridCsv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float
2024-10-07,Observed Holiday,Holiday Junior,,,,,`;

    const dataset = parseCsvToDataset(gridCsv);
    const holidayShift = dataset.shifts.find((shift) => shift.id === '2024-10-07_MOSES_JR');
    expect(holidayShift).toBeDefined();
    if (!holidayShift) return;
    const startHour = dayjs(holidayShift.startISO).diff(
      dayjs(holidayShift.startISO).startOf('day'),
      'hour',
    );
    expect(startHour).toBe(9);
  });

  it('reports missing required grid columns', () => {
    const missingColumnCsv = `Date,Day,Moses Junior,Moses Senior,IP Consult,Backup/Angio,Night Float
2024-12-01,Sunday,Alex Primary,Jamie Fellow,Pat Lee,Backup Buddy,Night Owl`;

    expect(() => parseCsvToDataset(missingColumnCsv)).toThrow(CsvValidationError);
    try {
      parseCsvToDataset(missingColumnCsv);
    } catch (error) {
      const err = error as CsvValidationError;
      expect(err.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            row: 1,
            column: 'Weiler',
            message: expect.stringContaining('Missing'),
          }),
        ]),
      );
    }
  });

  it('reports parser-level errors with row context', () => {
    const invalidQuoteCsv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float
"2024-10-01,Tuesday,Jane Resident,John Resident,Pat Lee,Alex Primary,Backup Buddy,Night Owl`;

    expect(() => parseCsvToDataset(invalidQuoteCsv)).toThrow(CsvValidationError);
    try {
      parseCsvToDataset(invalidQuoteCsv);
    } catch (error) {
      const err = error as CsvValidationError;
      expect(err.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expect.stringContaining('Quoted') }),
        ]),
      );
    }
  });

  it('raises a default grid format error when headers do not match expectations', () => {
    const arbitraryCsv = `Resident,Value
Alice,Chief`;

    let thrown: unknown;
    try {
      parseCsvToDataset(arbitraryCsv);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CsvValidationError);
    expect((thrown as CsvValidationError).issues).toContainEqual({
      row: 0,
      message: expect.stringContaining('Unable to parse CSV format'),
    });
  });

  it('requires a date when assignments are present in a row', () => {
    const missingDateCsv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float
,Monday,Resident One,,,,,`;

    let thrown: unknown;
    try {
      parseCsvToDataset(missingDateCsv);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CsvValidationError);
    expect((thrown as CsvValidationError).issues).toContainEqual({
      row: 2,
      column: 'Date',
      message: expect.stringContaining('Date is required'),
    });
  });

  it('ignores rows without a date when no assignments are present', () => {
    const csv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float
,Monday,,,,,,`;

    const dataset = parseCsvToDataset(csv);

    expect(dataset.shifts).toHaveLength(0);
    expect(dataset.residents).toHaveLength(0);
  });

  it('filters vacancy tokens and duplicates within a single cell', () => {
    const gridCsv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float
2024-10-01,Tuesday,"Primary Resident / OFF / Primary Resident / ???",,,,,`;

    const dataset = parseCsvToDataset(gridCsv);

    expect(dataset.shifts).toHaveLength(1);
    expect(dataset.residents).toHaveLength(1);
    expect(dataset.residents[0]?.name).toBe('Primary Resident');
  });

  it('flags duplicate shifts for the same day and column', () => {
    const gridCsv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float
2024-10-01,Tuesday,Resident One,,,,,
2024-10-01,Tuesday,Resident Two,,,,,`;

    let thrown: unknown;
    try {
      parseCsvToDataset(gridCsv);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(CsvValidationError);
    expect((thrown as CsvValidationError).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          row: 3,
          column: 'Moses Junior',
          message: expect.stringContaining('Duplicate shift id'),
        }),
      ]),
    );
  });

  it('requires valid calendar dates for assignments', () => {
    const csv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float
not-a-date,Monday,Resident One,,,,,`;

    expect(() => parseCsvToDataset(csv)).toThrow(CsvValidationError);
    try {
      parseCsvToDataset(csv);
    } catch (error) {
      const err = error as CsvValidationError;
      expect(err.issues).toContainEqual(
        expect.objectContaining({
          row: 2,
          column: 'Date',
          message: expect.stringContaining('valid calendar day'),
        }),
      );
    }
  });

  it('rejects dates outside the supported grid formats', () => {
    const csv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float
2024/10/01,Tuesday,Resident One,Resident Two,,,,`;

    expect(() => parseCsvToDataset(csv)).toThrow(CsvValidationError);
  });

  it('maps dataset validation errors to CSV issues with row context', async () => {
    vi.resetModules();
    vi.doMock('../../src/domain/types', async () => {
      const actual =
        await vi.importActual<typeof import('../../src/domain/types')>('../../src/domain/types');
      return {
        ...actual,
        parseDataset: vi.fn(() => {
          throw new actual.DatasetValidationError([
            { code: 'custom', path: ['shifts', 0, 'startISO'], message: 'invalid shift start' },
            { code: 'custom', path: ['residents', 1, 'name'], message: 'resident missing name' },
            { code: 'custom', path: ['other'], message: 'misc issue' },
          ]);
        }),
      };
    });

    const csvModule = await import('../../src/utils/csv');
    const csv = `Date,Day,Moses Junior,Moses Senior,Weiler,IP Consult,Backup/Angio,Night Float
 2024-10-01,Tuesday,Resident One,Resident Two,,,,`;

    let thrown: unknown;
    try {
      csvModule.parseCsvToDataset(csv);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(csvModule.CsvValidationError);
    expect((thrown as InstanceType<typeof csvModule.CsvValidationError>).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, column: 'startISO', message: 'invalid shift start' }),
        expect.objectContaining({ row: 2, column: 'name', message: 'resident missing name' }),
        expect.objectContaining({ row: 0, message: 'misc issue' }),
      ]),
    );

    vi.doUnmock('../../src/domain/types');
    vi.resetModules();
  });

  it('rejects duplicate grid headers after normalization', () => {
    const csv = `Date,Day,Moses Junior,Moses Junior ,Weiler,IP Consult,Backup/Angio,Night Float
2024-10-01,Tuesday,Resident One,Resident Two,Resident Three,,,,`;

    expect(() => parseCsvToDataset(csv)).toThrow(CsvValidationError);
    try {
      parseCsvToDataset(csv);
    } catch (error) {
      const err = error as CsvValidationError;
      expect(err.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            row: 1,
            message: expect.stringContaining('Duplicate column header'),
          }),
        ]),
      );
    }
  });

  it('allows blank column headers when the column is empty', () => {
    const csv = `Date,Day,Moses Junior,Moses Senior,,Weiler,IP Consult,Backup/Angio,Night Float
2024-10-01,Tuesday,Resident One,Resident Two,,Resident Three,,,,`;

    const dataset = parseCsvToDataset(csv);

    expect(dataset.shifts).toHaveLength(3);
    const residentNames = dataset.residents
      .map((resident) => resident.name)
      .sort((a, b) => a.localeCompare(b));
    expect(residentNames).toEqual(['Resident One', 'Resident Three', 'Resident Two']);
  });

  it('rejects blank column headers when populated', () => {
    const csv = `Date,Day,Moses Junior,,Weiler,IP Consult,Backup/Angio,Night Float
2024-10-01,Tuesday,Resident One,Unexpected Resident,Resident Three,,,,`;

    expect(() => parseCsvToDataset(csv)).toThrow(CsvValidationError);
    try {
      parseCsvToDataset(csv);
    } catch (error) {
      const err = error as CsvValidationError;
      expect(err.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            row: 1,
            message: expect.stringContaining('Blank column header'),
          }),
        ]),
      );
    }
  });

  it('defaults parser errors without row numbers to the header row', async () => {
    vi.resetModules();
    vi.doMock('papaparse', () => ({
      default: {
        parse: () => ({
          data: [],
          meta: { fields: ['Resident', 'Value'] },
          errors: [
            {
              type: 'Quotes',
              code: 'MissingQuotes',
              message: 'Expected closing quote',
              row: null,
            },
          ],
        }),
      },
    }));

    const csvModule = await import('../../src/utils/csv');

    expect(() => csvModule.parseCsvToDataset('Resident,Value\nAlice,Chief')).toThrow(
      csvModule.CsvValidationError,
    );

    let thrown: unknown;
    try {
      csvModule.parseCsvToDataset('Resident,Value\nAlice,Chief');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(csvModule.CsvValidationError);
    expect((thrown as InstanceType<typeof csvModule.CsvValidationError>).issues).toEqual([
      {
        row: 0,
        message: 'Expected closing quote',
      },
    ]);

    vi.doUnmock('papaparse');
    vi.resetModules();
  });
});

describe('CsvValidationError', () => {
  it('formats issues with row and column information', () => {
    const error = new CsvValidationError([
      { row: 5, column: 'Type', message: 'Invalid value' },
      { row: 8, message: 'Something else' },
    ]);

    expect(error.message).toContain('Row 5 (Type): Invalid value');
    expect(error.message).toContain('Row 8: Something else');
    expect(error.name).toBe('CsvValidationError');
  });
});

describe('canonicalizeResidentId', () => {
  it('normalizes accents and punctuation', () => {
    expect(canonicalizeResidentId("Jos\u00E9 O'Brien")).toBe('resident-jose-o-brien');
  });

  it('returns an empty string when no alphanumeric characters remain', () => {
    expect(canonicalizeResidentId('!!!')).toBe('');
  });
});
