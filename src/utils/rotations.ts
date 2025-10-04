import Papa from 'papaparse';
import dayjs from '@utils/dayjs';
import { type Dayjs } from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { RotationAssignment, ResidentAcademicYearAssignment } from '@domain/types';
import { canonicalizeResidentId } from './csv';

dayjs.extend(customParseFormat);

const ROTATION_DATE_FORMATS = ['M/D/YYYY', 'M/D/YY', 'YYYY-MM-DD'];
const ROTATION_BLOCK_LABEL = /^r\d+/i;
const VACATION_RANGE_PATTERN = /^V(\d{1,2})(?:-(\d{1,2}))?$/i;

export type RotationCsvIssue = {
  row: number;
  column?: number;
  message: string;
};

export class RotationCsvValidationError extends Error {
  constructor(public readonly issues: RotationCsvIssue[]) {
    super(
      issues
        .map((issue) => {
          const columnLabel = typeof issue.column === 'number' ? ` (column ${issue.column})` : '';
          return `Row ${issue.row}${columnLabel}: ${issue.message}`;
        })
        .join('\n'),
    );
    this.name = 'RotationCsvValidationError';
  }
}

export type ResidentRotationsMap = Map<string, RotationAssignment[]>;
export type ResidentAcademicYearMap = Map<string, ResidentAcademicYearAssignment[]>;

export type RotationParseResult = {
  rotations: ResidentRotationsMap;
  academicYears: ResidentAcademicYearMap;
};

export function parseRotationCsv(csv: string): RotationParseResult {
  const parsed = Papa.parse<string[]>(csv, {
    header: false,
    skipEmptyLines: false,
  });

  const issues: RotationCsvIssue[] = [];
  parsed.errors.forEach((error) => {
    const row = error.row == null ? 0 : error.row + 1;
    issues.push({ row, message: error.message });
  });

  const rows = parsed.data.map((rawRow) =>
    (rawRow ?? []).map((cell) => (typeof cell === 'string' ? cell.trim() : '')),
  );

  const rotations: ResidentRotationsMap = new Map();
  const academicYears: ResidentAcademicYearMap = new Map();

  let index = 0;
  while (index < rows.length) {
    const row = rows[index] ?? [];
    if (row.every((cell) => cell === '')) {
      index += 1;
      continue;
    }

    const firstCell = row[0] ?? '';
    if (firstCell && ROTATION_BLOCK_LABEL.test(firstCell)) {
      const { weekStarts, nextIndex, blockLabel } = parseWeekHeader(rows, index, issues);
      const yearLabel = blockLabel?.trim() ?? '';
      const academicYearStartISOs = resolveAcademicYearStartIsos(weekStarts);
      index = processRotationBlock({
        rows,
        startIndex: nextIndex,
        weekStarts,
        issues,
        rotations,
        academicYears,
        yearLabel,
        academicYearStartISOs,
      });
      continue;
    }

    index += 1;
  }

  rotations.forEach((assignments, residentId) => {
    const sorted = [...assignments].sort((a, b) => a.weekStartISO.localeCompare(b.weekStartISO));
    rotations.set(residentId, sorted);
  });

  if (issues.length > 0) {
    throw new RotationCsvValidationError(issues);
  }

  return { rotations, academicYears };
}

export function findRotationForDate(
  assignments: readonly RotationAssignment[],
  isoDate: string,
): RotationAssignment | null {
  if (!assignments || assignments.length === 0) {
    return null;
  }

  const target = dayjs(isoDate);
  if (!target.isValid()) {
    return null;
  }

  const day = target.startOf('day');

  for (let index = assignments.length - 1; index >= 0; index -= 1) {
    const assignment = assignments[index];
    if (!assignment) {
      continue;
    }

    const weekStart = dayjs(assignment.weekStartISO);
    if (!weekStart.isValid()) {
      continue;
    }

    if (day.isBefore(weekStart, 'day')) {
      continue;
    }

    const weekEnd = weekStart.add(6, 'day');
    if (day.isAfter(weekEnd, 'day')) {
      continue;
    }

    return assignment;
  }

  return null;
}

type RotationBlockContext = {
  rows: string[][];
  startIndex: number;
  weekStarts: (string | null)[];
  issues: RotationCsvIssue[];
  rotations: ResidentRotationsMap;
  academicYears: ResidentAcademicYearMap;
  yearLabel: string;
  academicYearStartISOs: readonly string[];
};

function processRotationBlock(context: RotationBlockContext): number {
  const {
    rows,
    startIndex,
    weekStarts,
    issues,
    rotations,
    academicYears,
    yearLabel,
    academicYearStartISOs,
  } = context;

  let index = startIndex;

  while (index < rows.length) {
    const dataRow = rows[index] ?? [];
    const label = dataRow[0]?.trim() ?? '';
    const isNextBlock = label && ROTATION_BLOCK_LABEL.test(label);

    if (isNextBlock) {
      break;
    }

    const hasAssignments = dataRow.slice(1).some((cell) => (cell ?? '').trim().length > 0);
    if (!label && !hasAssignments) {
      index += 1;
      continue;
    }

    if (!label) {
      index += 1;
      continue;
    }

    const residentId = canonicalizeResidentId(label);
    if (!residentId) {
      issues.push({
        row: index + 1,
        column: 1,
        message: `Unable to derive resident id from name "${label}"`,
      });
      index += 1;
      continue;
    }

    const assignments: RotationAssignment[] = buildAssignmentsForRow(dataRow, weekStarts);
    const existingAssignments = rotations.get(residentId) ?? [];
    rotations.set(residentId, existingAssignments.concat(assignments));
    recordAcademicYear({
      academicYears,
      residentId,
      yearLabel,
      academicYearStartISOs,
    });

    index += 1;
  }

  return index;
}

function buildAssignmentsForRow(
  dataRow: string[],
  weekStarts: (string | null)[],
): RotationAssignment[] {
  const assignments: RotationAssignment[] = [];
  for (let column = 1; column < weekStarts.length; column += 1) {
    const weekStartISO = weekStarts[column];
    if (!weekStartISO) {
      continue;
    }
    const rotationRaw = dataRow[column] ?? '';
    const rotation = rotationRaw.trim();
    if (!rotation) {
      continue;
    }
    const { rotationName, vacationDates } = parseRotationDetails(rotation, weekStartISO);
    assignments.push({
      weekStartISO,
      rotation: rotationName,
      rawRotation: rotation,
      vacationDates,
    });
  }
  return assignments;
}

function recordAcademicYear(params: {
  academicYears: ResidentAcademicYearMap;
  residentId: string;
  yearLabel: string;
  academicYearStartISOs: readonly string[];
}): void {
  const { academicYears, residentId, yearLabel, academicYearStartISOs } = params;
  if (!yearLabel || academicYearStartISOs.length === 0) {
    return;
  }

  const existingYears = academicYears.get(residentId) ?? [];
  const seen = new Set(existingYears.map((entry) => entry.academicYearStartISO));
  const additions = academicYearStartISOs
    .filter((iso) => iso && !seen.has(iso))
    .map((iso) => ({ academicYearStartISO: iso, label: yearLabel }));

  if (additions.length === 0) {
    return;
  }

  const nextYears = existingYears.concat(additions);
  const sortedYears = [...nextYears].sort((a, b) =>
    a.academicYearStartISO.localeCompare(b.academicYearStartISO),
  );
  academicYears.set(residentId, sortedYears);
}

function parseWeekHeader(
  rows: string[][],
  startIndex: number,
  issues: RotationCsvIssue[],
): { weekStarts: (string | null)[]; nextIndex: number; blockLabel: string | null } {
  const headerRows: { row: string[]; rowNumber: number }[] = [];
  let index = startIndex;

  while (index < rows.length) {
    const current = rows[index] ?? [];
    headerRows.push({ row: current, rowNumber: index + 1 });
    index += 1;

    const nextRow = rows[index];
    if (!nextRow) {
      break;
    }

    const nextFirst = nextRow[0]?.trim() ?? '';
    const nextHasValues = nextRow.slice(1).some((cell) => (cell ?? '').trim().length > 0);
    if (nextFirst || !nextHasValues) {
      break;
    }
  }

  const maxColumns = headerRows.reduce((max, entry) => Math.max(max, entry.row.length), 0);
  const weekStarts: (string | null)[] = Array(maxColumns).fill(null);
  const blockLabel = (headerRows[0]?.row[0] ?? '').trim() || null;

  for (let column = 1; column < maxColumns; column += 1) {
    const headerCell = headerRows
      .map((entry) => ({ value: entry.row[column]?.trim() ?? '', rowNumber: entry.rowNumber }))
      .find((entry) => entry.value.length > 0);

    if (!headerCell) {
      continue;
    }

    const parsed = parseWeekStartDate(headerCell.value);
    if (!parsed) {
      issues.push({
        row: headerCell.rowNumber,
        column,
        message: `Unable to parse week start date "${headerCell.value}"`,
      });
      continue;
    }

    if (parsed.day() !== 1) {
      issues.push({
        row: headerCell.rowNumber,
        column,
        message: `Week start ${parsed.format('YYYY-MM-DD')} must be a Monday`,
      });
      continue;
    }

    weekStarts[column] = parsed.utc(true).toISOString();
  }

  return { weekStarts, nextIndex: index, blockLabel };
}

function parseWeekStartDate(value: string): Dayjs | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  for (const format of ROTATION_DATE_FORMATS) {
    const parsed = dayjs(trimmed, format, true);
    if (parsed.isValid()) {
      return parsed.startOf('day');
    }
  }

  const fallback = dayjs(trimmed);
  return fallback.isValid() ? fallback.startOf('day') : null;
}

function resolveAcademicYearStartIsos(weekStarts: (string | null)[]): string[] {
  const academicYearStarts = new Set<string>();

  weekStarts.forEach((value) => {
    if (!value) {
      return;
    }

    const weekStart = dayjs.utc(value);
    if (!weekStart.isValid()) {
      return;
    }

    const julyFirstCurrentYear = dayjs
      .utc(`${weekStart.year()}-07-01T00:00:00.000Z`)
      .startOf('day');
    const academicYearStart = weekStart.isBefore(julyFirstCurrentYear, 'day')
      ? julyFirstCurrentYear.subtract(1, 'year')
      : julyFirstCurrentYear;

    academicYearStarts.add(academicYearStart.startOf('day').toISOString());
  });

  return Array.from(academicYearStarts).sort((a, b) => a.localeCompare(b));
}

function parseRotationDetails(
  rotation: string,
  weekStartISO: string,
): {
  rotationName: string;
  vacationDates: string[];
} {
  const weekStart = dayjs(weekStartISO);
  const vacationDates = new Set<string>();
  const spansToRemove: Array<{ start: number; end: number }> = [];

  const parentheticalMatches = [...rotation.matchAll(/\(([^)]*)\)/g)];
  for (const match of parentheticalMatches) {
    const content = match[1] ?? '';
    const vacationTokens = content.match(/V\s*\d{1,2}(?:\s*[-–]\s*\d{1,2})?/gi) ?? [];
    let hadVacationToken = false;

    vacationTokens.forEach((token) => {
      const normalizedToken = token.replace(/–/g, '-').replace(/\s+/g, '');
      const vacMatch = VACATION_RANGE_PATTERN.exec(normalizedToken);
      if (!vacMatch) {
        return;
      }
      const startDay = Number.parseInt(vacMatch[1] ?? '', 10);
      const endDay = vacMatch[2] ? Number.parseInt(vacMatch[2], 10) : startDay;
      if (Number.isNaN(startDay) || Number.isNaN(endDay)) {
        return;
      }
      const rangeStart = Math.min(startDay, endDay);
      const rangeEnd = Math.max(startDay, endDay);
      for (let day = rangeStart; day <= rangeEnd; day += 1) {
        const date = alignDayToWeek(day, weekStart);
        vacationDates.add(date.format('YYYY-MM-DD'));
      }
      hadVacationToken = true;
    });

    if (hadVacationToken && typeof match.index === 'number') {
      spansToRemove.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  let rotationName = rotation;
  if (spansToRemove.length > 0) {
    const orderedSpans = [...spansToRemove];
    orderedSpans.sort((a, b) => a.start - b.start);
    let result = '';
    let lastIndex = 0;
    for (const span of orderedSpans) {
      result += rotation.slice(lastIndex, span.start);
      lastIndex = span.end;
    }
    result += rotation.slice(lastIndex);
    rotationName = result;
  }

  rotationName = rotationName.replace(/\s+/g, ' ').trim();

  return {
    rotationName: rotationName.length > 0 ? rotationName : rotation,
    vacationDates: Array.from(vacationDates).sort((a, b) => a.localeCompare(b)),
  };
}

function alignDayToWeek(dayOfMonth: number, weekStart: Dayjs): Dayjs {
  let candidate = weekStart.date(dayOfMonth);
  if (candidate.isBefore(weekStart)) {
    candidate = candidate.add(1, 'month').date(dayOfMonth);
  }
  return candidate.startOf('day').utc(true);
}
