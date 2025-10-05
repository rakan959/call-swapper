import { SwapCandidate } from '@domain/types';
import { getCounterpartScore, getMyScore, getTotalScore } from '@utils/swapMetrics';
import { SwapSettings } from '@domain/swapSettings';

export type CandidateFilterOptions = Pick<
  SwapSettings,
  'hideNegativeResident' | 'hideNegativeTotal'
>;

const shouldHideCandidateBySettings = (
  candidate: SwapCandidate,
  options: CandidateFilterOptions,
): boolean => {
  if (options.hideNegativeResident) {
    const myScore = getMyScore(candidate);
    const counterpartScore = getCounterpartScore(candidate);
    if (myScore < 0 || counterpartScore < 0) {
      return true;
    }
  }
  if (options.hideNegativeTotal && getTotalScore(candidate) < 0) {
    return true;
  }
  return false;
};

export const filterCandidatesBySettings = (
  candidates: readonly SwapCandidate[],
  options: CandidateFilterOptions,
): SwapCandidate[] => {
  if (!options.hideNegativeResident && !options.hideNegativeTotal) {
    return [...candidates];
  }
  return candidates.filter((candidate) => !shouldHideCandidateBySettings(candidate, options));
};
