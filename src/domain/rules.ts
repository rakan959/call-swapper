import dayjs from '@utils/dayjs';
import { type Dayjs } from 'dayjs';
import { Context, Resident, Shift, SwapAdvisory, RotationAssignment } from './types';
import { isWeekendOrHoliday } from './calendar';
import { debugLog, debugError } from '@utils/debug';
import {
  isFridayCall,
  isNightFloat,
  isSaturdayDaytimeCall,
  isSaturdayNightFloat,
  ShabbosRestriction,
} from './shabbos';

export function hasOverlap(
  aStartISO: string,
  aEndISO: string,
  bStartISO: string,
  bEndISO: string,
): boolean {
  const aStart = dayjs(aStartISO);
  const aEnd = dayjs(aEndISO);
  const bStart = dayjs(bStartISO);
  const bEnd = dayjs(bEndISO);
  return aStart.isBefore(bEnd) && bStart.isBefore(aEnd);
}

export type RuleViolationCode = 'OVERLAP' | 'REST_WINDOW' | 'ELIGIBILITY' | 'TYPE_WHITELIST';

export class RuleViolationError extends Error {
  constructor(
    public readonly code: RuleViolationCode,
    public readonly residentId: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuleViolationError';
  }
}

type TimelineValidationOptions = {
  focusShiftIds?: ReadonlySet<string>;
  softTypes?: ReadonlySet<Shift['type']>;
};

const EMPTY_SOFT_TYPES: ReadonlySet<Shift['type']> = new Set();
const BACKUP_SOFT_TYPES: ReadonlySet<Shift['type']> = new Set(['BACKUP']);

const CALL_BLOCK_ROTATION_PATTERNS: RegExp[] = [
  /\bvacation\b/i,
  /\bresearch\b/i,
  /\bnf\b/i,
  /\bairp\b/i,
  /\bed[\s-]*nights?/i,
  /\brsna\b/i,
  /\bphysics\s+review\b/i,
  /\bnyrs\s+review\b/i,
  /\bmmc\s+board\s+review\s+prep\b/i,
  /\bnon-interpretive\s+skills\s+review\b/i,
  /\babr\s+board\s+exam\b/i,
  /\bus\s+scanning\b/i,
];

const MRI_COURSE_PATTERN = /\bmri\s+course\b/i;

function selectBackupPair(
  first: Shift,
  second: Shift,
  softTypes: ReadonlySet<Shift['type']>,
): { backup: Shift; other: Shift } {
  const firstIsSoft = softTypes.has(first.type);
  const secondIsSoft = softTypes.has(second.type);
  if (firstIsSoft && !secondIsSoft) {
    return { backup: first, other: second };
  }
  if (!firstIsSoft && secondIsSoft) {
    return { backup: second, other: first };
  }
  return { backup: first, other: second };
}

function shouldEvaluatePair(
  prev: Shift,
  current: Shift,
  focusShiftIds: ReadonlySet<string> | undefined,
): boolean {
  if (!focusShiftIds) {
    return true;
  }
  return focusShiftIds.has(prev.id) || focusShiftIds.has(current.id);
}

type MosesTier = 'junior' | 'senior';

function getMosesTier(shift: Shift): MosesTier | null {
  if (shift.type !== 'MOSES') {
    return null;
  }
  const location = (shift.location ?? '').toLowerCase();
  const id = shift.id.toLowerCase();
  if (location.includes('junior') || id.includes('moses_jr')) {
    return 'junior';
  }
  if (location.includes('senior') || id.includes('moses_sr')) {
    return 'senior';
  }
  return null;
}

function collectVacationDates(resident: Resident): Set<string> {
  const dates = new Set<string>();
  resident.rotations?.forEach((assignment) => {
    assignment.vacationDates.forEach((date) => dates.add(date));
  });
  return dates;
}

function isCallBlockedRotation(rotation: string): boolean {
  const trimmed = rotation.trim();
  if (!trimmed) {
    return false;
  }
  return CALL_BLOCK_ROTATION_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function matchesRotationPattern(value: string | undefined, pattern: RegExp): boolean {
  return typeof value === 'string' && pattern.test(value);
}

function resolveAcademicYearStartForDate(isoDate: string): string | null {
  const target = dayjs(isoDate);
  if (!target.isValid()) {
    return null;
  }

  const targetUtc = target.utc();
  const julyFirstCurrentYear = dayjs.utc(`${targetUtc.year()}-07-01T00:00:00.000Z`).startOf('day');
  const academicYearStart = targetUtc.isBefore(julyFirstCurrentYear, 'day')
    ? julyFirstCurrentYear.subtract(1, 'year')
    : julyFirstCurrentYear;

  return academicYearStart.startOf('day').toISOString();
}

function findResidentAcademicYearLabel(resident: Resident, shift: Shift): string | null {
  const assignments = resident.academicYears ?? [];
  if (assignments.length === 0) {
    return null;
  }

  const academicYearStartISO = resolveAcademicYearStartForDate(shift.startISO);
  if (!academicYearStartISO) {
    return null;
  }

  const match = assignments.find((entry) => entry.academicYearStartISO === academicYearStartISO);
  return match?.label ?? null;
}

function isResidentR3ForShift(resident: Resident, shift: Shift): boolean {
  const label = findResidentAcademicYearLabel(resident, shift);
  if (!label) {
    return false;
  }
  return label.trim().toLowerCase() === 'r3';
}

function isRotationBlockedForResident(
  assignment: RotationAssignment,
  resident: Resident,
  shift: Shift,
): boolean {
  if (isCallBlockedRotation(assignment.rotation) || isCallBlockedRotation(assignment.rawRotation)) {
    return true;
  }

  const isMriCourse =
    matchesRotationPattern(assignment.rotation, MRI_COURSE_PATTERN) ||
    matchesRotationPattern(assignment.rawRotation, MRI_COURSE_PATTERN);
  if (!isMriCourse) {
    return false;
  }

  return isResidentR3ForShift(resident, shift);
}

function collectRotationBlockedDates(assignment: RotationAssignment): Set<string> {
  const blocked = new Set<string>();
  const weekStart = dayjs(assignment.weekStartISO);
  if (!weekStart.isValid()) {
    return blocked;
  }

  const addDay = (value: Dayjs): void => {
    blocked.add(value.startOf('day').format('YYYY-MM-DD'));
  };

  addDay(weekStart.subtract(2, 'day'));
  addDay(weekStart.subtract(1, 'day'));

  for (let offset = 0; offset <= 6; offset += 1) {
    addDay(weekStart.add(offset, 'day'));
  }

  addDay(weekStart.add(12, 'day'));
  addDay(weekStart.add(13, 'day'));

  return blocked;
}

type RotationBlockConflict = {
  rotation: string;
  rotationWeekStartISO: string;
  conflictDates: string[];
};

function shiftRotationConflicts(shift: Shift, resident: Resident): RotationBlockConflict | null {
  const assignments = resident.rotations ?? [];
  if (assignments.length === 0) {
    return null;
  }

  const shiftDates = enumerateShiftCalendarDays(shift);
  if (shiftDates.length === 0) {
    return null;
  }

  for (const assignment of assignments) {
    if (!isRotationBlockedForResident(assignment, resident, shift)) {
      continue;
    }

    const blockedDates = collectRotationBlockedDates(assignment);
    const conflictDates = shiftDates.filter((date) => blockedDates.has(date));
    if (conflictDates.length > 0) {
      return {
        rotation: assignment.rotation,
        rotationWeekStartISO: assignment.weekStartISO,
        conflictDates,
      };
    }
  }

  return null;
}

function enumerateShiftCalendarDays(shift: Shift): string[] {
  const startDay = dayjs(shift.startISO).startOf('day');
  const endDay = dayjs(shift.endISO).startOf('day');
  const days: string[] = [];
  let cursor = startDay;

  while (!cursor.isAfter(endDay, 'day')) {
    days.push(cursor.format('YYYY-MM-DD'));
    cursor = cursor.add(1, 'day');
  }

  return days;
}

function shiftVacationConflicts(shift: Shift, resident: Resident): string[] {
  const vacationDates = collectVacationDates(resident);
  if (vacationDates.size === 0) {
    return [];
  }
  return enumerateShiftCalendarDays(shift).filter((date) => vacationDates.has(date));
}

function buildShabbosRestriction(
  resident: Resident,
  incomingShift: Shift,
  restriction: ShabbosRestriction,
): SwapRejectionReason {
  return {
    kind: 'shabbos-restriction',
    residentId: resident.id,
    shiftId: incomingShift.id,
    shiftType: incomingShift.type,
    shiftStartISO: incomingShift.startISO,
    restriction,
  };
}

function evaluateShabbosRestriction(
  resident: Resident,
  incomingShift: Shift,
  shabbosObservers: ReadonlySet<string>,
): SwapRejectionReason | null {
  const observesShabbos = shabbosObservers.has(resident.id);
  if (observesShabbos) {
    if (isNightFloat(incomingShift) && !isSaturdayNightFloat(incomingShift)) {
      return buildShabbosRestriction(resident, incomingShift, 'observer-night-float');
    }
    if (isFridayCall(incomingShift)) {
      return buildShabbosRestriction(resident, incomingShift, 'observer-friday-call');
    }
    if (isSaturdayDaytimeCall(incomingShift)) {
      return buildShabbosRestriction(resident, incomingShift, 'observer-saturday-daytime');
    }
    return null;
  }

  if (isNightFloat(incomingShift) && !isSaturdayNightFloat(incomingShift)) {
    return buildShabbosRestriction(resident, incomingShift, 'nonobserver-night-float');
  }

  return null;
}

function resolveShabbosRestrictionForSwap(
  shabbosObservers: ReadonlySet<string>,
  residentSwaps: Array<{ resident: Resident; incoming: Shift }>,
): SwapRejectionReason | null {
  for (const entry of residentSwaps) {
    const restriction = evaluateShabbosRestriction(
      entry.resident,
      entry.incoming,
      shabbosObservers,
    );
    if (restriction) {
      return restriction;
    }
  }
  return null;
}

function assertShiftAllowed(shift: Shift, cfg: Context['ruleConfig'], resident: Resident): void {
  if (cfg.typeWhitelist.length > 0 && !cfg.typeWhitelist.includes(shift.type)) {
    throw new RuleViolationError(
      'TYPE_WHITELIST',
      resident.id,
      `Shift ${shift.id} type ${shift.type} is not in whitelist`,
    );
  }

  if (!resident.eligibleShiftTypes.includes(shift.type)) {
    throw new RuleViolationError(
      'ELIGIBILITY',
      resident.id,
      `Resident ${resident.id} is not eligible for shift type ${shift.type}`,
    );
  }
}

function buildOverlapAdvisory(
  prev: Shift,
  current: Shift,
  resident: Resident,
  softTypes: ReadonlySet<Shift['type']>,
): SwapAdvisory {
  const { backup, other } = selectBackupPair(prev, current, softTypes);
  return {
    kind: 'backup-conflict',
    code: 'OVERLAP',
    residentId: resident.id,
    backupShiftId: backup.id,
    otherShiftId: other.id,
    message: `Shift ${other.id} overlaps with backup shift ${backup.id}. Consider swapping the backup separately.`,
  };
}

function buildRestAdvisory(
  prev: Shift,
  current: Shift,
  resident: Resident,
  softTypes: ReadonlySet<Shift['type']>,
  restHours: number,
  restHoursMin: number,
): SwapAdvisory {
  const { backup, other } = selectBackupPair(prev, current, softTypes);
  return {
    kind: 'backup-conflict',
    code: 'REST_WINDOW',
    residentId: resident.id,
    backupShiftId: backup.id,
    otherShiftId: other.id,
    message: `Rest window ${restHours.toFixed(2)}h between ${prev.id} and ${current.id} is below minimum ${restHoursMin}h because of backup shift ${backup.id}. Consider swapping the backup separately.`,
    restHours,
    minimumRestHours: restHoursMin,
  };
}

function evaluatePair(
  prev: Shift,
  current: Shift,
  cfg: Context['ruleConfig'],
  resident: Resident,
  softTypes: ReadonlySet<Shift['type']>,
): SwapAdvisory[] {
  const advisories: SwapAdvisory[] = [];
  const involvesSoftType = softTypes.has(prev.type) || softTypes.has(current.type);

  if (hasOverlap(prev.startISO, prev.endISO, current.startISO, current.endISO)) {
    if (involvesSoftType) {
      advisories.push(buildOverlapAdvisory(prev, current, resident, softTypes));
    } else {
      throw new RuleViolationError(
        'OVERLAP',
        resident.id,
        `Shifts ${prev.id} and ${current.id} overlap for resident ${resident.id}`,
      );
    }
  }

  const restHoursMin = cfg.restHoursMin ?? 0;
  if (restHoursMin > 0) {
    const restHours = dayjs(current.startISO).diff(dayjs(prev.endISO), 'hour', true);
    if (restHours < restHoursMin) {
      if (involvesSoftType) {
        advisories.push(
          buildRestAdvisory(prev, current, resident, softTypes, restHours, restHoursMin),
        );
      } else {
        throw new RuleViolationError(
          'REST_WINDOW',
          resident.id,
          `Rest window ${restHours.toFixed(2)}h between ${prev.id} and ${current.id} is below minimum ${restHoursMin}h`,
        );
      }
    }
  }

  return advisories;
}

export function validateResidentTimeline(
  shifts: readonly Shift[],
  cfg: Context['ruleConfig'],
  resident: Resident,
  options?: TimelineValidationOptions,
): SwapAdvisory[] {
  const sorted = [...shifts].sort((a, b) => a.startISO.localeCompare(b.startISO));
  const advisories: SwapAdvisory[] = [];
  const focusShiftIds = options?.focusShiftIds;
  const softTypes = options?.softTypes ?? EMPTY_SOFT_TYPES;

  const shouldEvaluateShift = (shiftId: string): boolean =>
    !focusShiftIds || focusShiftIds.has(shiftId);

  for (const shift of sorted) {
    if (!shouldEvaluateShift(shift.id)) {
      continue;
    }
    assertShiftAllowed(shift, cfg, resident);
  }

  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const current = sorted[i]!;
    if (!shouldEvaluatePair(prev, current, focusShiftIds)) {
      continue;
    }
    advisories.push(...evaluatePair(prev, current, cfg, resident, softTypes));
  }

  return advisories;
}

export type SwapRejectionReason =
  | { kind: 'missing-input'; shiftA?: string; shiftB?: string }
  | { kind: 'identical-shift'; shiftId: string }
  | { kind: 'same-resident'; residentId: string; shiftA: string; shiftB: string }
  | {
      kind: 'resident-missing';
      residentA: string;
      residentB: string;
      shiftA: string;
      shiftB: string;
    }
  | {
      kind: 'type-whitelist';
      whitelist: Shift['type'][];
      shiftA: { id: string; type: Shift['type'] };
      shiftB: { id: string; type: Shift['type'] };
    }
  | {
      kind: 'moses-tier-mismatch';
      shiftA: string;
      shiftB: string;
      tierA: MosesTier;
      tierB: MosesTier;
    }
  | {
      kind: 'weekend-mismatch';
      shiftA: string;
      shiftB: string;
      weekendOrHolidayA: boolean;
      weekendOrHolidayB: boolean;
    }
  | {
      kind: 'eligibility-a';
      residentId: string;
      attemptedType: Shift['type'];
      eligibleTypes: Shift['type'][];
      shiftA: string;
      shiftB: string;
    }
  | {
      kind: 'eligibility-b';
      residentId: string;
      attemptedType: Shift['type'];
      eligibleTypes: Shift['type'][];
      shiftA: string;
      shiftB: string;
    }
  | {
      kind: 'rule-violation';
      code: RuleViolationCode;
      message: string;
      residentId: string;
      shiftA: string;
      shiftB: string;
    }
  | {
      kind: 'vacation-conflict';
      residentId: string;
      shiftId: string;
      conflictDates: string[];
    }
  | {
      kind: 'rotation-block';
      residentId: string;
      shiftId: string;
      rotation: string;
      rotationWeekStartISO: string;
      conflictDates: string[];
    }
  | {
      kind: 'shabbos-restriction';
      residentId: string;
      shiftId: string;
      shiftType: Shift['type'];
      shiftStartISO: string;
      restriction: ShabbosRestriction;
    }
  | { kind: 'unexpected-error'; message: string; shiftA: string; shiftB: string };

type PreparedSwap = {
  ctx: Context;
  shiftA: Shift;
  shiftB: Shift;
  residentA: Resident;
  residentB: Resident;
};

function prepareSwap(
  a: Shift | undefined,
  b: Shift | undefined,
  ctx: Context | undefined,
): { failure?: SwapRejectionReason; data?: PreparedSwap } {
  if (!a || !b || !ctx) {
    return { failure: { kind: 'missing-input', shiftA: a?.id, shiftB: b?.id } };
  }
  if (a.id === b.id) {
    return { failure: { kind: 'identical-shift', shiftId: a.id } };
  }
  if (a.residentId === b.residentId) {
    return {
      failure: {
        kind: 'same-resident',
        residentId: a.residentId,
        shiftA: a.id,
        shiftB: b.id,
      },
    };
  }

  const residentA = ctx.residentsById.get(a.residentId);
  const residentB = ctx.residentsById.get(b.residentId);
  if (!residentA || !residentB) {
    return {
      failure: {
        kind: 'resident-missing',
        residentA: a.residentId,
        residentB: b.residentId,
        shiftA: a.id,
        shiftB: b.id,
      },
    };
  }

  const tierA = getMosesTier(a);
  const tierB = getMosesTier(b);
  if (tierA && tierB && tierA !== tierB) {
    return {
      failure: {
        kind: 'moses-tier-mismatch',
        shiftA: a.id,
        shiftB: b.id,
        tierA,
        tierB,
      },
    };
  }

  const weekendOrHolidayA = isWeekendOrHoliday(a);
  const weekendOrHolidayB = isWeekendOrHoliday(b);
  if (weekendOrHolidayA !== weekendOrHolidayB) {
    return {
      failure: {
        kind: 'weekend-mismatch',
        shiftA: a.id,
        shiftB: b.id,
        weekendOrHolidayA,
        weekendOrHolidayB,
      },
    };
  }

  const { typeWhitelist } = ctx.ruleConfig;
  if (typeWhitelist.length > 0) {
    if (!typeWhitelist.includes(a.type) || !typeWhitelist.includes(b.type)) {
      return {
        failure: {
          kind: 'type-whitelist',
          shiftA: { id: a.id, type: a.type },
          shiftB: { id: b.id, type: b.type },
          whitelist: typeWhitelist,
        },
      };
    }
  }

  if (!residentA.eligibleShiftTypes.includes(b.type)) {
    return {
      failure: {
        kind: 'eligibility-a',
        residentId: residentA.id,
        attemptedType: b.type,
        eligibleTypes: residentA.eligibleShiftTypes,
        shiftA: a.id,
        shiftB: b.id,
      },
    };
  }

  if (!residentB.eligibleShiftTypes.includes(a.type)) {
    return {
      failure: {
        kind: 'eligibility-b',
        residentId: residentB.id,
        attemptedType: a.type,
        eligibleTypes: residentB.eligibleShiftTypes,
        shiftA: a.id,
        shiftB: b.id,
      },
    };
  }

  return {
    data: {
      ctx,
      shiftA: a,
      shiftB: b,
      residentA,
      residentB,
    },
  };
}

export type SwapEvaluation =
  | { feasible: true; advisories?: SwapAdvisory[] }
  | { feasible: false; reason: SwapRejectionReason; advisories?: SwapAdvisory[] };

function evaluateSwap(
  a: Shift | undefined,
  b: Shift | undefined,
  ctx: Context | undefined,
): SwapEvaluation {
  const preparation = prepareSwap(a, b, ctx);
  if (preparation.failure) {
    return { feasible: false, reason: preparation.failure };
  }

  const { ctx: preparedCtx, shiftA, shiftB, residentA, residentB } = preparation.data!;
  const timelineA = (preparedCtx.shiftsByResident.get(shiftA.residentId) ?? []).filter(
    (shift) => shift.id !== shiftA.id,
  );
  const timelineB = (preparedCtx.shiftsByResident.get(shiftB.residentId) ?? []).filter(
    (shift) => shift.id !== shiftB.id,
  );

  const swappedForA: Shift = { ...shiftB, residentId: residentA.id };
  const swappedForB: Shift = { ...shiftA, residentId: residentB.id };

  const shabbosRestriction = resolveShabbosRestrictionForSwap(preparedCtx.shabbosObservers, [
    { resident: residentA, incoming: swappedForA },
    { resident: residentB, incoming: swappedForB },
  ]);
  if (shabbosRestriction) {
    return { feasible: false, reason: shabbosRestriction };
  }

  const vacationConflictsA = shiftVacationConflicts(swappedForA, residentA);
  if (vacationConflictsA.length > 0) {
    return {
      feasible: false,
      reason: {
        kind: 'vacation-conflict',
        residentId: residentA.id,
        shiftId: swappedForA.id,
        conflictDates: vacationConflictsA,
      },
    };
  }

  const rotationBlockA = shiftRotationConflicts(swappedForA, residentA);
  if (rotationBlockA) {
    return {
      feasible: false,
      reason: {
        kind: 'rotation-block',
        residentId: residentA.id,
        shiftId: swappedForA.id,
        rotation: rotationBlockA.rotation,
        rotationWeekStartISO: rotationBlockA.rotationWeekStartISO,
        conflictDates: rotationBlockA.conflictDates,
      },
    };
  }

  const vacationConflictsB = shiftVacationConflicts(swappedForB, residentB);
  if (vacationConflictsB.length > 0) {
    return {
      feasible: false,
      reason: {
        kind: 'vacation-conflict',
        residentId: residentB.id,
        shiftId: swappedForB.id,
        conflictDates: vacationConflictsB,
      },
    };
  }

  const rotationBlockB = shiftRotationConflicts(swappedForB, residentB);
  if (rotationBlockB) {
    return {
      feasible: false,
      reason: {
        kind: 'rotation-block',
        residentId: residentB.id,
        shiftId: swappedForB.id,
        rotation: rotationBlockB.rotation,
        rotationWeekStartISO: rotationBlockB.rotationWeekStartISO,
        conflictDates: rotationBlockB.conflictDates,
      },
    };
  }

  timelineA.push(swappedForA);
  timelineB.push(swappedForB);

  const advisories: SwapAdvisory[] = [];
  try {
    advisories.push(
      ...validateResidentTimeline(timelineA, preparedCtx.ruleConfig, residentA, {
        focusShiftIds: new Set([swappedForA.id]),
        softTypes: BACKUP_SOFT_TYPES,
      }),
    );
    advisories.push(
      ...validateResidentTimeline(timelineB, preparedCtx.ruleConfig, residentB, {
        focusShiftIds: new Set([swappedForB.id]),
        softTypes: BACKUP_SOFT_TYPES,
      }),
    );
  } catch (error) {
    if (error instanceof RuleViolationError) {
      return {
        feasible: false,
        reason: {
          kind: 'rule-violation',
          code: error.code,
          message: error.message,
          residentId: error.residentId,
          shiftA: shiftA.id,
          shiftB: shiftB.id,
        },
        advisories: advisories.length > 0 ? advisories : undefined,
      };
    }
    return {
      feasible: false,
      reason: {
        kind: 'unexpected-error',
        message: (error as Error | undefined)?.message ?? String(error),
        shiftA: shiftA.id,
        shiftB: shiftB.id,
      },
      advisories: advisories.length > 0 ? advisories : undefined,
    };
  }

  return advisories.length > 0 ? { feasible: true, advisories } : { feasible: true };
}

function logEvaluationResult(
  result: SwapEvaluation,
  a: Shift | undefined,
  b: Shift | undefined,
): void {
  if (!result.feasible) {
    debugLog('swap.reject', result.reason);
    return;
  }
  if (!a || !b) {
    return;
  }
  debugLog('swap.accepted', {
    shiftA: { id: a.id, resident: a.residentId, type: a.type, start: a.startISO, end: a.endISO },
    shiftB: { id: b.id, resident: b.residentId, type: b.type, start: b.startISO, end: b.endISO },
  });
  if (result.advisories?.length) {
    debugLog('swap.advisories', result.advisories.slice(0, 5));
  }
}

export function isFeasibleSwap(a: Shift, b: Shift, ctx: Context): boolean {
  const result = evaluateSwap(a, b, ctx);
  logEvaluationResult(result, a, b);
  if (!result.feasible && result.reason.kind === 'unexpected-error') {
    debugError('swap.reject-unexpected', result.reason);
  }
  return result.feasible;
}

export function explainSwap(a: Shift, b: Shift, ctx: Context): SwapEvaluation {
  return evaluateSwap(a, b, ctx);
}
