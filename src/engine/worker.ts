import { explainSwap } from '@domain/rules';
import type { SwapRejectionReason } from '@domain/rules';
import { calculateSwapPressure } from '@domain/simipar';
import { debugLog } from '@utils/debug';
import { hydrateContext } from './contextTransfer';
import type { WorkerIn, WorkerOut } from './workerProtocol';

self.onmessage = (event: MessageEvent<WorkerIn>) => {
  const message = event.data;
  debugLog('worker.message', () => ({ kind: message.kind }));
  if (message.kind !== 'evaluatePairs') {
    return;
  }

  debugLog('worker.evaluatePairs:start', () => ({ pairs: message.pairs.length }));
  const ctx = hydrateContext(message.ctx);
  const rejectionReasons = new Map<SwapRejectionReason['kind'], number>();
  type DiagnosticSample = { reason: SwapRejectionReason; shiftA: string; shiftB: string };
  const samples: DiagnosticSample[] = [];

  const candidates = [];
  for (const pair of message.pairs) {
    const evaluation = explainSwap(pair.a, pair.b, ctx);
    if (!evaluation.feasible) {
      const key = evaluation.reason.kind;
      rejectionReasons.set(key, (rejectionReasons.get(key) ?? 0) + 1);
      if (samples.length < 10) {
        samples.push({ reason: evaluation.reason, shiftA: pair.a.id, shiftB: pair.b.id });
      }
      continue;
    }

    const pressure = calculateSwapPressure(pair.a, pair.b, ctx);
    const candidate = {
      a: pair.a,
      b: pair.b,
      score: pressure.score,
      pressure,
      advisories: evaluation.advisories,
    };
    candidates.push(candidate);
  }

  const response: WorkerOut = {
    kind: 'pairsEvaluated',
    candidates,
    chunkSize: message.pairs.length,
    diagnostics: {
      totalPairs: message.pairs.length,
      accepted: candidates.length,
      rejectionReasons: Object.fromEntries(rejectionReasons.entries()),
      samples: samples.length > 0 ? samples : undefined,
    },
  };

  debugLog('worker.evaluatePairs:result', () => ({ candidates: candidates.length }));

  (self as unknown as Worker).postMessage(response);
};
