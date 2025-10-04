import { SwapCandidate } from './types';
import {
  getAverageScore,
  getCounterpartScore,
  getMyScore,
  getTotalScore,
} from '@utils/swapMetrics';

export type SwapSortKey = 'score' | 'myScore' | 'average' | 'date';
export type SortDirection = 'asc' | 'desc';

export const SWAP_SORT_LABELS: Record<SwapSortKey, string> = {
  score: 'Score',
  myScore: 'My Score',
  average: 'Average',
  date: 'Date',
};

export const SWAP_SORT_KEYS: readonly SwapSortKey[] = ['score', 'myScore', 'average', 'date'];

export function defaultSortDirection(key: SwapSortKey): SortDirection {
  return key === 'date' ? 'asc' : 'desc';
}

export type SwapComparatorContext = {
  direction: SortDirection;
  resolveDate: (candidate: SwapCandidate) => number;
  resolveTieBreaker?: (candidate: SwapCandidate) => string;
};

function applyDirection(value: number, direction: SortDirection): number {
  return direction === 'asc' ? value : -value;
}

function compareByDate(
  a: SwapCandidate,
  b: SwapCandidate,
  { direction, resolveDate, resolveTieBreaker }: SwapComparatorContext,
): number {
  const diff = resolveDate(a) - resolveDate(b);
  if (diff !== 0) {
    return applyDirection(diff, direction);
  }
  if (resolveTieBreaker) {
    return resolveTieBreaker(a).localeCompare(resolveTieBreaker(b));
  }
  return defaultTieBreaker(a).localeCompare(defaultTieBreaker(b));
}

function defaultTieBreaker(candidate: SwapCandidate): string {
  return `${candidate.a.id}::${candidate.b.id}`;
}

export function createSwapComparator(
  sortKey: SwapSortKey,
  context: SwapComparatorContext,
): (a: SwapCandidate, b: SwapCandidate) => number {
  const tieBreaker = context.resolveTieBreaker ?? defaultTieBreaker;
  if (sortKey === 'date') {
    return (a, b) => compareByDate(a, b, { ...context, resolveTieBreaker: tieBreaker });
  }

  const { direction, resolveDate } = context;

  return (a, b) => {
    const totalsA = {
      score: getTotalScore(a),
      my: getMyScore(a),
      counterpart: getCounterpartScore(a),
      average: getAverageScore(a),
    };
    const totalsB = {
      score: getTotalScore(b),
      my: getMyScore(b),
      counterpart: getCounterpartScore(b),
      average: getAverageScore(b),
    };

    let primaryA: number;
    let primaryB: number;
    switch (sortKey) {
      case 'myScore':
        primaryA = totalsA.my;
        primaryB = totalsB.my;
        break;
      case 'average':
        primaryA = totalsA.average;
        primaryB = totalsB.average;
        break;
      case 'score':
      default:
        primaryA = totalsA.score;
        primaryB = totalsB.score;
        break;
    }

    if (primaryA !== primaryB) {
      return applyDirection(primaryA - primaryB, direction);
    }

    if (sortKey === 'average') {
      if (totalsA.counterpart !== totalsB.counterpart) {
        return applyDirection(totalsA.counterpart - totalsB.counterpart, direction);
      }
    }

    if (totalsA.score !== totalsB.score) {
      return applyDirection(totalsA.score - totalsB.score, 'desc');
    }

    const dateDiff = resolveDate(a) - resolveDate(b);
    if (dateDiff !== 0) {
      return applyDirection(dateDiff, 'asc');
    }

    return tieBreaker(a).localeCompare(tieBreaker(b));
  };
}

export function ensureSwapSortKey(value: unknown, fallback: SwapSortKey): SwapSortKey {
  if (typeof value !== 'string') {
    return fallback;
  }
  const lower = value.trim().toLowerCase();
  const match = SWAP_SORT_KEYS.find((key) => key.toLowerCase() === lower);
  return match ?? fallback;
}
