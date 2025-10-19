import dayjs from '@utils/dayjs';
import { type ConfigType } from 'dayjs';
import {
  Dataset,
  Shift,
  Context,
  SwapCandidate,
  RuleConfig,
  ShiftType,
  SwapPressureBreakdown,
} from '@domain/types';
import { explainSwap } from '@domain/rules';
import type { SwapRejectionReason } from '@domain/rules';
import { debugLog, withDebugGroup } from '@utils/debug';
import { evaluatePairs } from './workerPool';
import type { ShiftPair } from './workerProtocol';
import { resolveShabbosObservers } from '@domain/shabbos';
import { calculateSwapPressure } from '@domain/simipar';

const DEFAULT_REST_HOURS_MIN = 8;

export type SwapEngineOptions = {
  today?: ConfigType;
  collectRejections?: boolean;
};

export type SwapRejectionCategory = 'general' | 'shabbos';

export type SwapRejectionDetail = {
  a: Shift;
  b: Shift;
  score: number;
  pressure: SwapPressureBreakdown;
  reason: SwapRejectionReason;
  reasonLabel: string;
  category: SwapRejectionCategory;
};

export type SwapSearchResult = {
  accepted: SwapCandidate[];
  rejected: SwapRejectionDetail[];
};

function resolveToday(options?: SwapEngineOptions) {
  return dayjs(options?.today ?? undefined).startOf('day');
}

function buildContext(dataset: Dataset, cfg?: Partial<RuleConfig>): Context {
  const residentsById = new Map(dataset.residents.map((r) => [r.id, r]));
  const shiftsByResident = new Map<string, Shift[]>();
  for (const s of dataset.shifts) {
    const arr = shiftsByResident.get(s.residentId) || [];
    arr.push(s);
    shiftsByResident.set(s.residentId, arr);
  }
  for (const [, arr] of shiftsByResident) arr.sort((a, b) => a.startISO.localeCompare(b.startISO));
  const shabbosObservers = resolveShabbosObservers(shiftsByResident);
  const context: Context = {
    residentsById,
    shiftsByResident,
    shabbosObservers,
    ruleConfig: {
      restHoursMin: DEFAULT_REST_HOURS_MIN,
      typeWhitelist: Array.from(
        new Set<ShiftType>(dataset.shifts.map((shift: Shift) => shift.type)),
      ),
      ...cfg,
    },
  };
  debugLog('context.build', () => ({
    residents: dataset.residents.length,
    shifts: dataset.shifts.length,
    ruleConfig: context.ruleConfig,
    overrides: cfg ? Object.keys(cfg) : [],
  }));
  return context;
}

type RejectionSummary = {
  totalPairs: number;
  accepted: number;
  rejectionReasons: Record<string, number>;
  samples?: Array<{ reason: SwapRejectionReason; shiftA: string; shiftB: string }>;
};

function summarizeRejections(pairs: ShiftPair[], ctx: Context): RejectionSummary {
  const rejectionCounts = new Map<string, number>();
  const samples: NonNullable<RejectionSummary['samples']> = [];
  let accepted = 0;

  for (const pair of pairs) {
    const evaluation = explainSwap(pair.a, pair.b, ctx);
    if (!evaluation.feasible) {
      const key = evaluation.reason.kind;
      rejectionCounts.set(key, (rejectionCounts.get(key) ?? 0) + 1);
      if (samples.length < 10) {
        samples.push({ reason: evaluation.reason, shiftA: pair.a.id, shiftB: pair.b.id });
      }
      continue;
    }
    accepted += 1;
  }

  return {
    totalPairs: pairs.length,
    accepted,
    rejectionReasons: Object.fromEntries(rejectionCounts.entries()),
    samples: samples.length > 0 ? samples : undefined,
  };
}

function describeReason(reason: SwapRejectionReason): unknown {
  switch (reason.kind) {
    case 'rule-violation':
      return { code: reason.code, message: reason.message, residentId: reason.residentId };
    case 'unexpected-error':
      return { message: reason.message };
    case 'eligibility-a':
    case 'eligibility-b':
      return {
        residentId: reason.residentId,
        attemptedType: reason.attemptedType,
        eligibleTypes: reason.eligibleTypes,
      };
    case 'type-whitelist':
      return {
        whitelist: reason.whitelist,
        shiftAType: reason.shiftA.type,
        shiftBType: reason.shiftB.type,
      };
    case 'weekend-mismatch':
      return {
        shiftA: reason.shiftA,
        shiftB: reason.shiftB,
        weekendOrHolidayA: reason.weekendOrHolidayA,
        weekendOrHolidayB: reason.weekendOrHolidayB,
      };
    case 'moses-tier-mismatch':
      return {
        shiftA: reason.shiftA,
        shiftB: reason.shiftB,
        tierA: reason.tierA,
        tierB: reason.tierB,
      };
    case 'same-resident':
      return {
        residentId: reason.residentId,
        shiftA: reason.shiftA,
        shiftB: reason.shiftB,
      };
    case 'resident-missing':
      return {
        residentA: reason.residentA,
        residentB: reason.residentB,
        shiftA: reason.shiftA,
        shiftB: reason.shiftB,
      };
    case 'missing-input':
      return { shiftA: reason.shiftA, shiftB: reason.shiftB };
    case 'identical-shift':
      return { shiftId: reason.shiftId };
    case 'vacation-conflict':
      return {
        residentId: reason.residentId,
        shiftId: reason.shiftId,
        conflictDates: reason.conflictDates,
      };
    case 'shabbos-restriction':
      return {
        residentId: reason.residentId,
        shiftId: reason.shiftId,
        restriction: reason.restriction,
        shiftType: reason.shiftType,
        shiftStartISO: reason.shiftStartISO,
      };
    default:
      return undefined;
  }
}

function summarizeRejectionReason(reason: SwapRejectionReason): string {
  switch (reason.kind) {
    case 'rule-violation':
      return `${reason.code}: ${reason.message}`;
    case 'eligibility-a':
    case 'eligibility-b':
      return `Resident ${reason.residentId} is not eligible for ${reason.attemptedType}`;
    case 'type-whitelist':
      return `Shift types ${reason.shiftA.type} and ${reason.shiftB.type} are not whitelisted`;
    case 'weekend-mismatch':
      return `Weekend/holiday mismatch between ${reason.shiftA} and ${reason.shiftB}`;
    case 'moses-tier-mismatch':
      return `Moses tier mismatch (${reason.tierA} vs ${reason.tierB})`;
    case 'same-resident':
      return `Same resident (${reason.residentId}) cannot swap shifts ${reason.shiftA} and ${reason.shiftB}`;
    case 'resident-missing':
      return `Missing resident data for ${reason.residentA} or ${reason.residentB}`;
    case 'missing-input':
      return 'Missing shift data in evaluation';
    case 'identical-shift':
      return `Shift ${reason.shiftId} cannot swap with itself`;
    case 'vacation-conflict':
      return `Vacation conflict for resident ${reason.residentId}`;
    case 'rotation-block':
      return `Rotation block conflict (${reason.rotation})`;
    case 'shabbos-restriction':
      return `Shabbos restriction (${reason.restriction}) for resident ${reason.residentId}`;
    case 'unexpected-error':
      return `Unexpected error: ${reason.message}`;
    default:
      return 'Swap rejected for an unknown reason';
  }
}

function makePairKey(a: Shift, b: Shift): string {
  return `${a.id}::${b.id}`;
}

function collectRejectedSwaps(
  pairs: ShiftPair[],
  acceptedKeys: ReadonlySet<string>,
  ctx: Context,
): SwapRejectionDetail[] {
  const rejected: SwapRejectionDetail[] = [];
  for (const pair of pairs) {
    const key = makePairKey(pair.a, pair.b);
    if (acceptedKeys.has(key)) {
      continue;
    }
    const evaluation = explainSwap(pair.a, pair.b, ctx);
    if (evaluation.feasible) {
      continue;
    }
    const pressure = calculateSwapPressure(pair.a, pair.b, ctx);
    const category: SwapRejectionCategory =
      evaluation.reason.kind === 'shabbos-restriction' ? 'shabbos' : 'general';
    rejected.push({
      a: pair.a,
      b: pair.b,
      score: pressure.score,
      pressure,
      reason: evaluation.reason,
      reasonLabel: summarizeRejectionReason(evaluation.reason),
      category,
    });
  }

  rejected.sort((left, right) => right.score - left.score);
  return rejected;
}

function buildSearchResult(
  label: string,
  pairs: ShiftPair[],
  ctx: Context,
  evaluated: SwapCandidate[],
  collectRejections: boolean,
  formatTopEntry: (candidate: SwapCandidate) => unknown,
): SwapSearchResult {
  evaluated.sort((x, y) => y.score - x.score);
  if (evaluated.length === 0) {
    const summary = summarizeRejections(pairs, ctx);
    debugLog(`${label}:rejections`, summary);
    logRejectionSummary(label, summary);
  }

  const rejected = collectRejections
    ? collectRejectedSwaps(
        pairs,
        new Set(evaluated.map((candidate) => makePairKey(candidate.a, candidate.b))),
        ctx,
      )
    : [];

  debugLog(`${label}:results`, () => ({
    feasible: evaluated.length,
    top: evaluated.slice(0, 5).map(formatTopEntry),
    rejected: rejected.length,
  }));

  return { accepted: evaluated, rejected };
}

function isShiftInPast(shift: Shift, today: dayjs.Dayjs): boolean {
  return dayjs(shift.startISO).isBefore(today, 'day');
}

function isEligibleCounterpart(
  target: Shift,
  candidate: Shift,
  residentId: string,
  today: dayjs.Dayjs,
): boolean {
  if (candidate.residentId === residentId) {
    return false;
  }
  if (candidate.type === 'BACKUP') {
    return false;
  }
  if (target.type !== candidate.type) {
    return false;
  }
  if (target.id === candidate.id) {
    return false;
  }
  if (isShiftInPast(candidate, today)) {
    return false;
  }
  return true;
}

function collectBestSwapPairs(
  dataset: Dataset,
  residentId: string,
  today: dayjs.Dayjs,
): { primary: Shift[]; pairs: ShiftPair[] } {
  const primary = dataset.shifts.filter(
    (shift) => shift.residentId === residentId && shift.type !== 'BACKUP',
  );

  const pairs: ShiftPair[] = [];
  for (const target of primary) {
    if (isShiftInPast(target, today)) {
      continue;
    }
    for (const candidate of dataset.shifts) {
      if (!isEligibleCounterpart(target, candidate, residentId, today)) {
        continue;
      }
      pairs.push({ a: target, b: candidate });
    }
  }

  return { primary, pairs };
}

function logRejectionSummary(label: string, summary: RejectionSummary): void {
  const topReasons = Object.entries(summary.rejectionReasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  debugLog(`${label}:topReasons`, topReasons);
  if (summary.samples?.length) {
    const sampleDetails = summary.samples.slice(0, 5).map((sample) => ({
      shiftA: sample.shiftA,
      shiftB: sample.shiftB,
      reason: sample.reason.kind,
      detail: describeReason(sample.reason),
    }));
    debugLog(`${label}:samplePairs`, sampleDetails);
  }
}

export async function findSwapsForShift(
  dataset: Dataset,
  target: Shift,
  options?: SwapEngineOptions,
): Promise<SwapSearchResult> {
  return withDebugGroup(
    'findSwapsForShift',
    () => ({
      targetId: target.id,
      resident: target.residentId,
      type: target.type,
      todayOverride: options?.today,
    }),
    async () => {
      debugLog('findSwapsForShift:dataset', {
        residentCount: dataset.residents.length,
        shiftCount: dataset.shifts.length,
      });
      const today = resolveToday(options);
      if (dayjs(target.startISO).isBefore(today, 'day')) {
        debugLog('findSwapsForShift:target-in-past', {
          shiftId: target.id,
          start: target.startISO,
        });
        return { accepted: [], rejected: [] };
      }
      const ctx = buildContext(dataset);
      const candidates = dataset.shifts.filter(
        (s) =>
          s.residentId !== target.residentId &&
          s.type === target.type &&
          !dayjs(s.startISO).isBefore(today, 'day'),
      );
      debugLog('findSwapsForShift:candidates', () => ({ count: candidates.length }));
      const pairs: ShiftPair[] = candidates.map((b) => ({ a: target, b }));
      debugLog('findSwapsForShift:pairs', () => ({ count: pairs.length }));
      const evaluated = await evaluatePairs(pairs, ctx);
      return buildSearchResult(
        'findSwapsForShift',
        pairs,
        ctx,
        evaluated,
        options?.collectRejections ?? false,
        (candidate) => ({ partner: candidate.b.id, score: candidate.score }),
      );
    },
  );
}

export async function findBestSwaps(
  dataset: Dataset,
  residentId: string,
  options?: SwapEngineOptions,
): Promise<SwapSearchResult> {
  return withDebugGroup(
    'findBestSwaps',
    () => ({
      residentId,
      todayOverride: options?.today,
    }),
    async () => {
      const today = resolveToday(options);
      const { primary, pairs } = collectBestSwapPairs(dataset, residentId, today);
      if (primary.length === 0) {
        debugLog('findBestSwaps:no-primary-shifts', { residentId });
        return { accepted: [], rejected: [] };
      }

      const ctx = buildContext(dataset);
      debugLog('findBestSwaps:pairs', {
        count: pairs.length,
        primaryShiftCount: primary.length,
      });
      const evaluated = await evaluatePairs(pairs, ctx);
      return buildSearchResult(
        'findBestSwaps',
        pairs,
        ctx,
        evaluated,
        options?.collectRejections ?? false,
        (candidate) => ({ a: candidate.a.id, b: candidate.b.id, score: candidate.score }),
      );
    },
  );
}
