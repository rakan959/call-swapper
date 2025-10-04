import Papa from 'papaparse';
import dayjs from '@utils/dayjs';
import { type Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import {
  Dataset,
  DatasetValidationError,
  Resident,
  Shift,
  ShiftType,
  SHIFT_TYPES,
  parseDataset,
} from '@domain/types';

const DEFAULT_ELIGIBLE_SHIFT_TYPES: ShiftType[] = [...SHIFT_TYPES];

dayjs.extend(customParseFormat);

const BOM_PATTERN = /^\uFEFF/;

function stripBom(value: string): string {
  return value.replace(BOM_PATTERN, '');
}

type ShiftRowContext = {
  date: Dayjs;
  dayLabel?: string;
  isWeekend: boolean;
  isHoliday: boolean;
};

type GridShiftConfig = {
  headerVariants: string[];
  idSuffix: string;
  location: string;
  type: ShiftType;
  resolveWindow: (context: ShiftRowContext) => { start: Dayjs; end: Dayjs };
};

const GRID_SHIFT_CONFIGS: GridShiftConfig[] = [
  {
    headerVariants: ['Moses Junior'],
    idSuffix: 'MOSES_JR',
    location: 'Moses Junior',
    type: 'MOSES',
    resolveWindow: (context) =>
      isWeekendOrHoliday(context)
        ? buildWindow(context.date, 9, 0, 13)
        : buildWindow(context.date, 17, 0, 5),
  },
  {
    headerVariants: ['Moses Senior'],
    idSuffix: 'MOSES_SR',
    location: 'Moses Senior',
    type: 'MOSES',
    resolveWindow: (context) =>
      isWeekendOrHoliday(context)
        ? buildWindow(context.date, 9, 0, 13)
        : buildWindow(context.date, 17, 0, 5),
  },
  {
    headerVariants: ['Weiler', 'Weiler '],
    idSuffix: 'WEILER',
    location: 'Weiler',
    type: 'WEILER',
    resolveWindow: (context) =>
      isWeekendOrHoliday(context)
        ? buildWindow(context.date, 13, 0, 8)
        : buildWindow(context.date, 17, 0, 4),
  },
  {
    headerVariants: ['IP Consult'],
    idSuffix: 'IP_CONSULT',
    location: 'IP Consult',
    type: 'IP CONSULT',
    resolveWindow: (context) =>
      isWeekendOrHoliday(context)
        ? buildWindow(context.date, 9, 0, 13)
        : buildWindow(context.date, 17, 0, 5),
  },
  {
    headerVariants: ['Backup/Angio', 'Angio/Backup', 'Backup / Angio', 'Angio / Backup'],
    idSuffix: 'BACKUP',
    location: 'Backup/Angio',
    type: 'BACKUP',
    resolveWindow: (context) => buildWindow(context.date, 9, 0, 24),
  },
  {
    headerVariants: ['Night Float'],
    idSuffix: 'NIGHT_FLOAT',
    location: 'Night Float',
    type: 'NIGHT FLOAT',
    resolveWindow: (context) => buildWindow(context.date, 22, 0, 11),
  },
];

const GRID_DATE_FORMATS = ['M/D/YYYY', 'M/D/YY', 'YYYY-MM-DD'];

const VACANCY_TOKENS = new Set(['off', 'vac', 'vacation', 'tbd', 'na', 'n/a', 'open', 'none']);
const PRIMARY_NAME_REGEX = /^[^/(,&+]+/;

export type CsvIssue = {
  row: number;
  column?: string;
  message: string;
};

export class CsvValidationError extends Error {
  constructor(public readonly issues: CsvIssue[]) {
    super(
      issues
        .map((issue) => {
          const columnLabel = issue.column ? ` (${issue.column})` : '';
          return `Row ${issue.row}${columnLabel}: ${issue.message}`;
        })
        .join('\n'),
    );
    this.name = 'CsvValidationError';
  }
}

function collectParseErrors(
  parsed: Papa.ParseResult<Record<string, string>>,
  issues: CsvIssue[],
): void {
  parsed.errors.forEach((error: Papa.ParseError) => {
    if (error.type === 'FieldMismatch') {
      return;
    }

    const row = error.row == null ? 0 : error.row + 2;
    issues.push({ row, message: error.message });
  });
}

export function parseCsvToDataset(csv: string): Dataset {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => stripBom(header).trim(),
  });

  const issues: CsvIssue[] = [];
  const originalFields = (parsed.meta.fields ?? []).map((field: string | undefined) => field ?? '');
  const normalizedFieldSet = new Set<string>(
    originalFields.map((field: string) => normalizeHeader(field)),
  );

  if (looksLikeGridCsv(normalizedFieldSet)) {
    return parseGridCsv(parsed, issues, originalFields);
  }

  collectParseErrors(parsed, issues);

  if (issues.length === 0) {
    issues.push({ row: 0, message: 'Unable to parse CSV format. Expected schedule grid layout.' });
  }

  throw new CsvValidationError(issues);
}

type GridParseContext = {
  residentsById: Map<string, Resident>;
  residentRowById: Map<string, number>;
  shifts: Shift[];
  shiftRows: number[];
  issues: CsvIssue[];
};

function parseGridCsv(
  parsed: Papa.ParseResult<Record<string, string>>,
  issues: CsvIssue[],
  originalFields: string[],
): Dataset {
  collectParseErrors(parsed, issues);

  const headerLookup = new Map<string, string>();
  const duplicateHeaders = new Set<string>();
  const blankHeaderIndexes: number[] = [];

  originalFields.forEach((field, index) => {
    const sanitized = stripBom(field);
    const baseSanitized = sanitized.replace(/_\d+$/, '');
    const normalized = normalizeHeader(baseSanitized);
    if (!normalized) {
      blankHeaderIndexes.push(index);
      return;
    }
    if (headerLookup.has(normalized)) {
      const displayLabel = baseSanitized || sanitized || `Column ${index + 1}`;
      duplicateHeaders.add(displayLabel);
      const existing = headerLookup.get(normalized);
      if (existing) {
        duplicateHeaders.add(existing);
      }
      return;
    }
    headerLookup.set(normalized, sanitized);
  });

  duplicateHeaders.forEach((label) => {
    issues.push({ row: 1, column: label, message: 'Duplicate column header detected' });
  });

  const resolvedColumns = GRID_SHIFT_CONFIGS.map((config) => {
    const resolvedHeader = config.headerVariants
      .map((variant) => headerLookup.get(normalizeHeader(variant)))
      .find((value) => typeof value === 'string');
    if (!resolvedHeader) {
      issues.push({ row: 1, column: config.headerVariants[0], message: 'Missing required column' });
    }
    return {
      config,
      header: resolvedHeader,
    };
  });

  const dateHeader = headerLookup.get('date');
  const dayHeader =
    headerLookup.get('day') ??
    headerLookup.get('day of week') ??
    headerLookup.get('weekday') ??
    headerLookup.get('day-of-week');
  if (!dateHeader) {
    issues.push({ row: 1, column: 'Date', message: 'Missing required column' });
  }

  if (blankHeaderIndexes.length > 0) {
    const fieldKeys = parsed.meta.fields ?? [];
    const rows = parsed.data;

    blankHeaderIndexes.forEach((index) => {
      const columnLabel = `Column ${index + 1}`;
      const fieldKey = fieldKeys[index] ?? '';
      const hasData = rows.some((row) => {
        if (!row) return false;
        if (fieldKey in row) {
          const value = row[fieldKey];
          return typeof value === 'string' && value.trim().length > 0;
        }
        const values = Object.values(row);
        const rawValue = values[index];
        return typeof rawValue === 'string' && rawValue.trim().length > 0;
      });

      if (hasData) {
        issues.push({
          row: 1,
          column: columnLabel,
          message: 'Blank column header detected',
        });
      }
    });
  }

  if (issues.length > 0) {
    throw new CsvValidationError(issues);
  }

  const ensuredDateHeader = dateHeader!;

  const residentsById = new Map<string, Resident>();
  const residentRowById = new Map<string, number>();
  const shifts: Shift[] = [];
  const shiftRows: number[] = [];
  const context: GridParseContext = {
    residentsById,
    residentRowById,
    shifts,
    shiftRows,
    issues,
  };

  const rows = parsed.data;

  for (let index = 0; index < rows.length; index += 1) {
    const raw = rows[index];
    if (!raw) continue;
    const rowNumber = index + 2;

    const rowContext = resolveRowContext(
      raw,
      ensuredDateHeader,
      dayHeader,
      resolvedColumns,
      rowNumber,
      issues,
    );
    if (!rowContext) {
      continue;
    }

    for (const column of resolvedColumns) {
      addAssignmentsForCell(raw, column, rowContext, rowNumber, context);
    }
  }

  if (issues.length > 0) {
    throw new CsvValidationError(issues);
  }

  const residents = Array.from(residentsById.values()).sort((a, b) => a.name.localeCompare(b.name));
  shifts.sort((a, b) => a.startISO.localeCompare(b.startISO));

  try {
    return parseDataset({ residents, shifts });
  } catch (err) {
    if (err instanceof DatasetValidationError) {
      const datasetIssues: CsvIssue[] = err.issues.map((issue) => {
        const path = Array.isArray(issue.path) ? issue.path : [];
        if (path[0] === 'shifts' && typeof path[1] === 'number') {
          const row = shiftRows[path[1]] ?? 0;
          const column = typeof path[2] === 'string' ? path[2] : undefined;
          return { row, column, message: issue.message };
        }
        if (path[0] === 'residents' && typeof path[1] === 'number') {
          const resident = residents[path[1]];
          const row = resident ? (residentRowById.get(resident.id) ?? 0) : 0;
          const column = typeof path[2] === 'string' ? path[2] : undefined;
          return { row, column, message: issue.message };
        }
        return { row: 0, message: issue.message };
      });
      throw new CsvValidationError(datasetIssues);
    }
    throw err;
  }
}

function resolveRowContext(
  raw: Record<string, string>,
  dateHeader: string,
  dayHeader: string | undefined,
  resolvedColumns: { config: GridShiftConfig; header?: string }[],
  rowNumber: number,
  issues: CsvIssue[],
): ShiftRowContext | null {
  const rawDate = (raw[dateHeader] || '').trim();
  if (!rawDate) {
    const hasAssignments = resolvedColumns.some(({ header }) => {
      if (!header) return false;
      const cellValue = raw[header];
      return typeof cellValue === 'string' && cellValue.trim().length > 0;
    });
    if (hasAssignments) {
      issues.push({ row: rowNumber, column: 'Date', message: 'Date is required for assignments' });
    }
    return null;
  }

  const date = parseGridDate(rawDate);
  if (!date) {
    issues.push({
      row: rowNumber,
      column: 'Date',
      message: 'Date must be a valid calendar day (e.g., M/D/YYYY)',
    });
    return null;
  }

  const dayLabel = dayHeader ? (raw[dayHeader] || '').trim() || undefined : undefined;
  const normalizedDayLabel = (dayLabel ?? '').toLowerCase();
  const isWeekend = date.day() === 0 || date.day() === 6;
  const isHoliday =
    normalizedDayLabel.includes('holiday') || normalizedDayLabel.includes('observed');

  return { date, dayLabel, isWeekend, isHoliday };
}

function addAssignmentsForCell(
  raw: Record<string, string>,
  column: { config: GridShiftConfig; header?: string },
  rowContext: ShiftRowContext,
  rowNumber: number,
  context: GridParseContext,
): void {
  const { config, header } = column;
  if (!header) {
    return;
  }

  const rawValue = raw[header];
  if (typeof rawValue !== 'string') {
    return;
  }

  const assignments = extractAssignments(rawValue);
  if (assignments.length === 0) {
    return;
  }

  const { start, end } = config.resolveWindow(rowContext);
  const baseShiftId = `${start.format('YYYY-MM-DD')}_${config.idSuffix}`;

  for (let index = 0; index < assignments.length; index += 1) {
    const assignment = assignments[index]!;

    if (!context.residentsById.has(assignment.residentId)) {
      const resident: Resident = {
        id: assignment.residentId,
        name: assignment.displayName,
        eligibleShiftTypes: [...DEFAULT_ELIGIBLE_SHIFT_TYPES],
        rotations: [],
        academicYears: [],
      };
      context.residentsById.set(assignment.residentId, resident);
      context.residentRowById.set(assignment.residentId, rowNumber);
    }

    const shiftId = index === 0 ? baseShiftId : `${baseShiftId}__${index + 1}`;
    if (context.shifts.some((shift) => shift.id === shiftId)) {
      context.issues.push({
        row: rowNumber,
        column: config.location,
        message: `Duplicate shift id "${shiftId}"`,
      });
      break;
    }

    const shift: Shift = {
      id: shiftId,
      residentId: assignment.residentId,
      startISO: start.toISOString(),
      endISO: end.toISOString(),
      type: config.type,
      location: config.location,
    };

    context.shifts.push(shift);
    context.shiftRows.push(rowNumber);
  }
}

function buildWindow(date: Dayjs, startHour: number, startMinute: number, durationHours: number) {
  const start = date.clone().hour(startHour).minute(startMinute).second(0).millisecond(0);
  const end = start.clone().add(durationHours, 'hour');
  return { start, end };
}

function isWeekendOrHoliday(context: ShiftRowContext): boolean {
  return context.isWeekend || context.isHoliday;
}

function looksLikeGridCsv(normalizedFieldSet: Set<string>): boolean {
  if (!normalizedFieldSet.has('date')) {
    return false;
  }
  return GRID_SHIFT_CONFIGS.some((config) =>
    config.headerVariants.some((variant) => normalizedFieldSet.has(normalizeHeader(variant))),
  );
}

function normalizeHeader(header: string): string {
  return header.trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseGridDate(value: string): Dayjs | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  for (const format of GRID_DATE_FORMATS) {
    const parsed = dayjs(trimmed, format, true);
    if (parsed.isValid()) {
      return parsed.startOf('day');
    }
  }
  return null;
}

type Assignment = {
  residentId: string;
  displayName: string;
};

function extractAssignments(raw: string): Assignment[] {
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return [];
  }

  const lower = normalized.toLowerCase();
  if (VACANCY_TOKENS.has(lower)) {
    return [];
  }

  const withoutParentheses = normalized
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutParentheses) {
    return [];
  }

  const cleanedQuotes = withoutParentheses.replace(/[\u2018\u2019]/g, "'");
  const segments = cleanedQuotes.split(/\s*\/\s*/);

  const seen = new Set<string>();
  const assignments: Assignment[] = [];

  segments.forEach((segment) => {
    const value = segment.replace(/\s+/g, ' ').trim();
    if (!value) {
      return;
    }

    const vacancy = value.toLowerCase();
    if (VACANCY_TOKENS.has(vacancy)) {
      return;
    }

    const match = PRIMARY_NAME_REGEX.exec(value);
    const primary = (match ? match[0] : value).trim();
    if (!primary) {
      return;
    }

    const residentId = canonicalizeResidentId(primary);
    if (!residentId || seen.has(residentId)) {
      return;
    }

    seen.add(residentId);
    assignments.push({ residentId, displayName: primary });
  });

  return assignments;
}

export function canonicalizeResidentId(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .toLowerCase();

  if (!ascii) {
    return '';
  }

  return `resident-${ascii}`;
}
