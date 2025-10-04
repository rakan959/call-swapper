import { SwapCandidate } from '@domain/types';

export function getMyScore(candidate: SwapCandidate): number {
  return candidate.pressure.original.deltaTotal;
}

export function getCounterpartScore(candidate: SwapCandidate): number {
  return candidate.pressure.counterpart.deltaTotal;
}

export function getTotalScore(candidate: SwapCandidate): number {
  return candidate.score;
}

export function getAverageScore(candidate: SwapCandidate): number {
  const myScore = getMyScore(candidate);
  const counterpartScore = getCounterpartScore(candidate);
  return (myScore + counterpartScore) / 2;
}
