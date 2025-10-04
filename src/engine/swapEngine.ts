import dayjs from '@utils/dayjs';
import { type ConfigType } from 'dayjs';
import { Dataset, Shift, Context, SwapCandidate, RuleConfig, ShiftType } from '@domain/types';
import { explainSwap } from '@domain/rules';
import type { SwapRejectionReason } from '@domain/rules';
import { debugLog, withDebugGroup } from '@utils/debug';
import { evaluatePairs } from './workerPool';
import type { ShiftPair } from './workerProtocol';
import { resolveShabbosObservers } from '@domain/shabbos';

const DEFAULT_REST_HOURS_MIN = 8;

export type SwapEngineOptions = {
  today?: ConfigType;
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
): Promise<SwapCandidate[]> {
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
        return [];
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
      evaluated.sort((x, y) => y.score - x.score);
      if (evaluated.length === 0) {
        const summary = summarizeRejections(pairs, ctx);
        debugLog('findSwapsForShift:rejections', summary);
        logRejectionSummary('findSwapsForShift', summary);
      }
      debugLog('findSwapsForShift:results', () => ({
        feasible: evaluated.length,
        top: evaluated.slice(0, 5).map((candidate) => ({
          partner: candidate.b.id,
          score: candidate.score,
        })),
      }));
      return evaluated;
    },
  );
}

export async function findBestSwaps(
  dataset: Dataset,
  residentId: string,
  options?: SwapEngineOptions,
): Promise<SwapCandidate[]> {
  return withDebugGroup(
    'findBestSwaps',
    () => ({
      residentId,
      todayOverride: options?.today,
    }),
    async () => {
      const primaryShifts = dataset.shifts.filter((shift) => shift.residentId === residentId);
      if (primaryShifts.length === 0) {
        debugLog('findBestSwaps:no-primary-shifts', { residentId });
        return [];
      }

      const ctx = buildContext(dataset);
      const pairs: ShiftPair[] = [];
      const today = resolveToday(options);
      for (const a of primaryShifts) {
        if (dayjs(a.startISO).isBefore(today, 'day')) {
          continue;
        }
        for (const b of dataset.shifts) {
          if (b.residentId === residentId) continue;
          if (a.type !== b.type) continue;
          if (a.id === b.id) continue;
          if (dayjs(b.startISO).isBefore(today, 'day')) continue;
          pairs.push({ a, b });
        }
      }
      debugLog('findBestSwaps:pairs', {
        count: pairs.length,
        primaryShiftCount: primaryShifts.length,
      });
      const evaluated = await evaluatePairs(pairs, ctx);
      evaluated.sort((x, y) => y.score - x.score);
      if (evaluated.length === 0) {
        const summary = summarizeRejections(pairs, ctx);
        debugLog('findBestSwaps:rejections', summary);
        logRejectionSummary('findBestSwaps', summary);
      }
      debugLog('findBestSwaps:results', () => ({
        feasible: evaluated.length,
        top: evaluated.slice(0, 5).map((candidate) => ({
          a: candidate.a.id,
          b: candidate.b.id,
          score: candidate.score,
        })),
      }));
      return evaluated;
    },
  );
}
