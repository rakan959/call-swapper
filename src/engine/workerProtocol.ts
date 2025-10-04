import type { Shift, SwapCandidate } from '@domain/types';
import type { SerializableContext } from './contextTransfer';
import type { SwapRejectionReason } from '@domain/rules';

export type ShiftPair = { a: Shift; b: Shift };

export type WorkerIn = {
  kind: 'evaluatePairs';
  pairs: ShiftPair[];
  ctx: SerializableContext;
};

export type WorkerOut = {
  kind: 'pairsEvaluated';
  candidates: SwapCandidate[];
  chunkSize: number;
  diagnostics?: {
    totalPairs: number;
    accepted: number;
    rejectionReasons: Record<string, number>;
    samples?: Array<{ reason: SwapRejectionReason; shiftA: string; shiftB: string }>;
  };
};
