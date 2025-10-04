import dayjs from '@utils/dayjs';
import { findRotationForDate } from '@utils/rotations';
import { isWeekend, isWeekendOrHoliday } from './calendar';
import {
  Context,
  Resident,
  Shift,
  SwapPressureBreakdown,
  SwapPressureSection,
  SwapPressureCall,
} from './types';

const COMFORTABLE_REST_BUFFER_HOURS = 12;
const CALL_WINDOW_DAYS = 4;
const CALL_WINDOW_HOURS = CALL_WINDOW_DAYS * 24;
const ZERO_CALLS: SwapPressureCall[] = [];
const MIN_CLOSENESS = 1e-3;
const SCORE_SCALE = 100;
const IP_CONSULT_MISMATCH_PENALTY = -50;
const ROTATION_PRESSURE_BONUS = 100;
const ROTATION_PRESSURE_PATTERNS: RegExp[] = [
  /\bgi\b/i,
  /\bwet\s+desk\b/i,
  /\bangio\b/i,
  /\bm\s*neuro\s*&\s*procedures\b/i,
];
const ROTATION_MAMMO_PATTERN = /mammo/i;

/**
 * proximityPressure: deterministic swap desirability score in [-1, 1].
 * Positive deltas indicate the swap improves aggregate pressure; negative values indicate regressions.
 */
export function proximityPressure(a: Shift, b: Shift, ctx: Context): number {
  return calculateSwapPressure(a, b, ctx).score;
}

export function calculateSwapPressure(a: Shift, b: Shift, ctx: Context): SwapPressureBreakdown {
  const zero = buildZeroBreakdown(a, b);
  if (!a || !b || !ctx) {
    return zero;
  }
  if (a.id === b.id || a.residentId === b.residentId) {
    return zero;
  }

  const residentA = ctx.residentsById.get(a.residentId);
  const residentB = ctx.residentsById.get(b.residentId);
  if (!residentA || !residentB) {
    return zero;
  }
  if (!residentA.eligibleShiftTypes.includes(b.type)) {
    return zero;
  }
  if (!residentB.eligibleShiftTypes.includes(a.type)) {
    return zero;
  }

  const otherShiftsA = (ctx.shiftsByResident.get(a.residentId) ?? []).filter(
    (shift) => shift.id !== a.id,
  );
  const otherShiftsB = (ctx.shiftsByResident.get(b.residentId) ?? []).filter(
    (shift) => shift.id !== b.id,
  );

  const restMin = Math.max(0, ctx.ruleConfig.restHoursMin ?? 0);

  const originalSection = buildSection(
    a,
    { ...b, residentId: residentA.id },
    otherShiftsA,
    restMin,
  );

  const counterpartSection = buildSection(
    b,
    { ...a, residentId: residentB.id },
    otherShiftsB,
    restMin,
  );

  const baselineScore = originalSection.baselineTotal + counterpartSection.baselineTotal;
  const swappedScore = originalSection.swappedTotal + counterpartSection.swappedTotal;
  const deltaScore = swappedScore - baselineScore;

  const breakdown: SwapPressureBreakdown = {
    score: deltaScore,
    baselineScore,
    swappedScore,
    original: originalSection,
    counterpart: counterpartSection,
  };

  const multiplier = SCORE_SCALE * resolveShiftMultiplier(a) * resolveShiftMultiplier(b);
  const scaledBreakdown = scaleBreakdown(breakdown, multiplier);
  const penalty = resolveIpConsultPenalty(a, b, ctx);
  const withConsultPenalty = applyIpConsultPenalty(scaledBreakdown, penalty, a, b);
  return applyRotationPressure(withConsultPenalty, a, b, residentA, residentB);
}

function buildZeroBreakdown(a: Shift | undefined, b: Shift | undefined): SwapPressureBreakdown {
  return {
    score: 0,
    baselineScore: 0,
    swappedScore: 0,
    original: {
      residentId: a?.residentId ?? '',
      focusShiftId: a?.id ?? '',
      windowHours: CALL_WINDOW_HOURS,
      calls: ZERO_CALLS,
      baselineTotal: 0,
      swappedTotal: 0,
      deltaTotal: 0,
    },
    counterpart: {
      residentId: b?.residentId ?? '',
      focusShiftId: b?.id ?? '',
      windowHours: CALL_WINDOW_HOURS,
      calls: ZERO_CALLS,
      baselineTotal: 0,
      swappedTotal: 0,
      deltaTotal: 0,
    },
  };
}

function buildSection(
  baselineShift: Shift,
  swappedShift: Shift,
  otherShifts: Shift[],
  restMin: number,
): SwapPressureSection {
  const baseline = collectScenario(baselineShift, otherShifts, restMin);
  const swapped = collectScenario(swappedShift, otherShifts, restMin);

  const mergedIds = new Set<string>([
    ...baseline.contributions.keys(),
    ...swapped.contributions.keys(),
  ]);

  type Entry = {
    shift: Shift;
    before?: ScenarioContribution;
    after?: ScenarioContribution;
    weight: number;
  };

  const entries: Entry[] = [];

  for (const shiftId of mergedIds) {
    const before = baseline.contributions.get(shiftId);
    const after = swapped.contributions.get(shiftId);
    const shift = before?.shift ?? after?.shift;
    if (!shift) {
      continue;
    }

    const weight = Math.max(before?.closeness ?? 0, after?.closeness ?? 0);
    if (weight <= 0) {
      continue;
    }

    entries.push({ shift, before, after, weight });
  }

  if (entries.length === 0) {
    return {
      residentId: baselineShift.residentId,
      focusShiftId: baselineShift.id,
      windowHours: CALL_WINDOW_HOURS,
      calls: ZERO_CALLS,
      baselineTotal: 0,
      swappedTotal: 0,
      deltaTotal: 0,
    };
  }

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const calls: SwapPressureCall[] = [];
  let baselineTotal = 0;
  let swappedTotal = 0;

  for (const entry of entries) {
    const normalizedWeight = totalWeight > 0 ? entry.weight / totalWeight : 0;
    const baselineContribution = entry.before ? entry.before.penalty * normalizedWeight : 0;
    const swappedContribution = entry.after ? entry.after.penalty * normalizedWeight : 0;
    const deltaContribution = swappedContribution - baselineContribution;

    baselineTotal += baselineContribution;
    swappedTotal += swappedContribution;

    calls.push({
      shiftId: entry.shift.id,
      shiftType: entry.shift.type,
      startISO: entry.shift.startISO,
      endISO: entry.shift.endISO,
      weight: entry.weight,
      baseline: baselineContribution,
      swapped: swappedContribution,
      delta: deltaContribution,
      calendarContext: resolveCallCalendarContext(entry.shift),
    });
  }

  calls.sort((a, b) => {
    const deltaMagnitude = Math.abs(b.delta) - Math.abs(a.delta);
    if (deltaMagnitude !== 0) {
      return deltaMagnitude;
    }
    const weightDiff = b.weight - a.weight;
    if (weightDiff !== 0) {
      return weightDiff;
    }
    return a.shiftId.localeCompare(b.shiftId);
  });

  return {
    residentId: baselineShift.residentId,
    focusShiftId: baselineShift.id,
    windowHours: CALL_WINDOW_HOURS,
    calls,
    baselineTotal,
    swappedTotal,
    deltaTotal: swappedTotal - baselineTotal,
  };
}

type ScenarioContribution = {
  shift: Shift;
  closeness: number;
  penalty: number;
};

type ScenarioSummary = {
  contributions: Map<string, ScenarioContribution>;
  weightTotal: number;
};

function resolveShiftMultiplier(shift: Shift): number {
  if (shift.type === 'BACKUP') {
    return 1;
  }

  const weekendOrHoliday = isWeekendOrHoliday(shift);
  const isNightFloat = shift.type === 'NIGHT FLOAT';
  if (!weekendOrHoliday && !isNightFloat) {
    return 1;
  }

  // Weekend/holiday or Night Float individually apply 2x; both together cap at 4x.
  return weekendOrHoliday && isNightFloat ? 4 : 2;
}

function scaleBreakdown(breakdown: SwapPressureBreakdown, factor: number): SwapPressureBreakdown {
  if (!Number.isFinite(factor) || factor === 1) {
    return breakdown;
  }

  const scaleCall = (call: SwapPressureCall): SwapPressureCall => ({
    ...call,
    baseline: call.baseline * factor,
    swapped: call.swapped * factor,
    delta: call.delta * factor,
  });

  const scaleSection = (section: SwapPressureSection): SwapPressureSection => ({
    ...section,
    calls: section.calls.length === 0 ? section.calls : section.calls.map(scaleCall),
    baselineTotal: section.baselineTotal * factor,
    swappedTotal: section.swappedTotal * factor,
    deltaTotal: section.deltaTotal * factor,
  });

  return {
    ...breakdown,
    score: breakdown.score * factor,
    baselineScore: breakdown.baselineScore * factor,
    swappedScore: breakdown.swappedScore * factor,
    original: scaleSection(breakdown.original),
    counterpart: scaleSection(breakdown.counterpart),
  };
}

function isMosesSenior(shift: Shift): boolean {
  if (shift.type !== 'MOSES') {
    return false;
  }

  const location = (shift.location ?? '').toLowerCase();
  if (location.includes('senior')) {
    return true;
  }

  const id = shift.id.toLowerCase();
  return id.includes('moses_sr');
}

function hasAssociatedIpConsult(shift: Shift, ctx: Context): boolean {
  const residentShifts = ctx.shiftsByResident.get(shift.residentId);
  if (!residentShifts) {
    return false;
  }

  const targetDay = dayjs(shift.startISO);
  if (!targetDay.isValid()) {
    return false;
  }

  return residentShifts.some((other) => {
    if (other.id === shift.id) {
      return false;
    }
    if (other.type !== 'IP CONSULT') {
      return false;
    }
    const otherDay = dayjs(other.startISO);
    return otherDay.isValid() && otherDay.isSame(targetDay, 'day');
  });
}

function resolveCallCalendarContext(shift: Shift): 'weekend' | 'holiday' | null {
  if (shift.isHoliday) {
    return 'holiday';
  }
  if (isWeekend(shift.startISO) || isWeekend(shift.endISO)) {
    return 'weekend';
  }
  return null;
}

function resolveIpConsultPenalty(a: Shift, b: Shift, ctx: Context): number {
  if (!isMosesSenior(a) || !isMosesSenior(b)) {
    return 0;
  }

  const aHasConsult = hasAssociatedIpConsult(a, ctx);
  const bHasConsult = hasAssociatedIpConsult(b, ctx);
  if (aHasConsult === bHasConsult) {
    return 0;
  }

  return IP_CONSULT_MISMATCH_PENALTY;
}

function applyIpConsultPenalty(
  breakdown: SwapPressureBreakdown,
  penalty: number,
  originalShift: Shift,
  counterpartShift: Shift,
): SwapPressureBreakdown {
  if (!Number.isFinite(penalty) || penalty === 0) {
    return breakdown;
  }

  const share = penalty / 2;
  const appendPenalty = (section: SwapPressureSection, shift: Shift): SwapPressureSection => {
    const penaltyCall: SwapPressureCall = {
      shiftId: `penalty:ip-consult:${shift.id}`,
      shiftType: shift.type,
      startISO: shift.startISO,
      endISO: shift.endISO,
      weight: 0,
      baseline: 0,
      swapped: share,
      delta: share,
      calendarContext: resolveCallCalendarContext(shift),
      rotationLabel: null,
    };

    return {
      ...section,
      calls: [...section.calls, penaltyCall],
      swappedTotal: section.swappedTotal + share,
      deltaTotal: section.deltaTotal + share,
    };
  };

  return {
    ...breakdown,
    score: breakdown.score + penalty,
    swappedScore: breakdown.swappedScore + penalty,
    original: appendPenalty(breakdown.original, originalShift),
    counterpart: appendPenalty(breakdown.counterpart, counterpartShift),
  };
}

type RotationPressureBonus = {
  value: number;
  label: string | null;
};

function applyRotationPressure(
  breakdown: SwapPressureBreakdown,
  originalShift: Shift,
  counterpartShift: Shift,
  originalResident: Resident,
  counterpartResident: Resident,
): SwapPressureBreakdown {
  let updated = breakdown;

  const originalBaseline = resolveRotationPressureBonus(originalResident, originalShift);
  if (originalBaseline.value > 0) {
    updated = appendRotationPressureCall(
      updated,
      'original',
      originalShift,
      originalResident,
      'baseline',
      originalBaseline,
    );
  }

  const originalSwapped = resolveRotationPressureBonus(originalResident, counterpartShift);
  if (originalSwapped.value > 0) {
    updated = appendRotationPressureCall(
      updated,
      'original',
      counterpartShift,
      originalResident,
      'swapped',
      originalSwapped,
    );
  }

  const counterpartBaseline = resolveRotationPressureBonus(counterpartResident, counterpartShift);
  if (counterpartBaseline.value > 0) {
    updated = appendRotationPressureCall(
      updated,
      'counterpart',
      counterpartShift,
      counterpartResident,
      'baseline',
      counterpartBaseline,
    );
  }

  const counterpartSwapped = resolveRotationPressureBonus(counterpartResident, originalShift);
  if (counterpartSwapped.value > 0) {
    updated = appendRotationPressureCall(
      updated,
      'counterpart',
      originalShift,
      counterpartResident,
      'swapped',
      counterpartSwapped,
    );
  }

  return updated;
}

function appendRotationPressureCall(
  breakdown: SwapPressureBreakdown,
  sectionKey: 'original' | 'counterpart',
  shift: Shift,
  resident: Resident,
  mode: 'baseline' | 'swapped',
  bonus: RotationPressureBonus,
): SwapPressureBreakdown {
  const section = sectionKey === 'original' ? breakdown.original : breakdown.counterpart;

  const baseline = mode === 'baseline' ? -bonus.value : 0;
  const swapped = mode === 'baseline' ? 0 : -bonus.value;
  const delta = mode === 'baseline' ? bonus.value : -bonus.value;

  const rotationCall: SwapPressureCall = {
    shiftId: `bonus:rotation:${mode}:${shift.id}:${resident.id}`,
    shiftType: shift.type,
    startISO: shift.startISO,
    endISO: shift.endISO,
    weight: 0,
    baseline,
    swapped,
    delta,
    calendarContext: resolveCallCalendarContext(shift),
    rotationLabel: bonus.label,
  };

  const updatedSection: SwapPressureSection = {
    ...section,
    calls: [...section.calls, rotationCall],
    baselineTotal: section.baselineTotal + baseline,
    swappedTotal: section.swappedTotal + swapped,
    deltaTotal: section.deltaTotal + delta,
  };

  return {
    ...breakdown,
    score: breakdown.score + delta,
    baselineScore: breakdown.baselineScore + baseline,
    swappedScore: breakdown.swappedScore + swapped,
    original: sectionKey === 'original' ? updatedSection : breakdown.original,
    counterpart: sectionKey === 'counterpart' ? updatedSection : breakdown.counterpart,
  };
}

function resolveRotationPressureBonus(
  resident: Resident | undefined,
  shift: Shift,
): RotationPressureBonus {
  if (!resident?.rotations?.length) {
    return { value: 0, label: null };
  }

  const assignment = findRotationForDate(resident.rotations, shift.startISO);
  if (!assignment) {
    return { value: 0, label: null };
  }

  const rotationCandidates = [assignment.rotation, assignment.rawRotation];
  const matched = rotationCandidates.find((candidate) => isHighPressureRotationName(candidate));
  if (!matched) {
    return { value: 0, label: null };
  }

  const label = matched.trim() || assignment.rotation || assignment.rawRotation || null;
  return { value: ROTATION_PRESSURE_BONUS, label };
}

function isHighPressureRotationName(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim();
  if (!normalized) {
    return false;
  }

  if (ROTATION_MAMMO_PATTERN.test(normalized)) {
    return true;
  }

  return ROTATION_PRESSURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function collectScenario(
  focusShift: Shift,
  otherShifts: Shift[],
  restMin: number,
): ScenarioSummary {
  const focusStart = dayjs(focusShift.startISO);
  const focusEnd = dayjs(focusShift.endISO);
  const comfortable = Math.max(restMin + COMFORTABLE_REST_BUFFER_HOURS, CALL_WINDOW_HOURS);

  const contributions = new Map<string, ScenarioContribution>();
  let weightTotal = 0;

  for (const other of otherShifts) {
    if (other.type === 'BACKUP') {
      continue;
    }
    const otherStart = dayjs(other.startISO);
    const otherEnd = dayjs(other.endISO);

    const distanceHours = Math.abs(focusStart.diff(otherStart, 'hour', true));
    if (distanceHours > CALL_WINDOW_HOURS) {
      continue;
    }

    const closenessRaw = 1 - distanceHours / CALL_WINDOW_HOURS;
    const closeness = closenessRaw > 0 ? closenessRaw : MIN_CLOSENESS;

    const gapHours = computeGapHours(focusStart, focusEnd, otherStart, otherEnd);
    const restValue = normaliseGap(gapHours, restMin, comfortable);
    const penalty = -(1 - restValue);

    contributions.set(other.id, {
      shift: other,
      closeness,
      penalty,
    });
    weightTotal += closeness;
  }

  return {
    contributions,
    weightTotal,
  };
}

function computeGapHours(
  focusStart: dayjs.Dayjs,
  focusEnd: dayjs.Dayjs,
  otherStart: dayjs.Dayjs,
  otherEnd: dayjs.Dayjs,
): number {
  if (otherEnd.valueOf() <= focusStart.valueOf()) {
    return focusStart.diff(otherEnd, 'hour', true);
  }
  if (otherStart.valueOf() >= focusEnd.valueOf()) {
    return otherStart.diff(focusEnd, 'hour', true);
  }
  return 0;
}

function normaliseGap(value: number, restMin: number, comfortable: number): number {
  if (!Number.isFinite(value)) {
    return 1;
  }
  if (value <= restMin) {
    return 0;
  }
  if (value >= comfortable) {
    return 1;
  }
  return (value - restMin) / (comfortable - restMin);
}
