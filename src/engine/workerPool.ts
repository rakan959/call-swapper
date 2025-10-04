import type { Context, SwapCandidate } from '@domain/types';
import { calculateSwapPressure } from '@domain/simipar';
import { explainSwap } from '@domain/rules';
import { debugLog } from '@utils/debug';
import { serializeContext } from './contextTransfer';
import type { WorkerIn, WorkerOut, ShiftPair } from './workerProtocol';
import type { SwapRejectionReason } from '@domain/rules';

export const CANDIDATE_WORKER_THRESHOLD = 200;
const MAX_POOL_SIZE = 4;

type WorkerFactory = () => Worker;

export type SwapWorkerPoolOptions = {
  size?: number;
  threshold?: number;
  workerFactory?: WorkerFactory | null;
};

type Spawnability = {
  factory: WorkerFactory | null;
  allowNoGlobalWorker: boolean;
};

class WorkerAdapter {
  private readonly worker: Worker;
  private queue: Promise<void> = Promise.resolve();

  constructor(factory: WorkerFactory) {
    this.worker = factory();
  }

  runTask(message: WorkerIn): Promise<WorkerOut> {
    const execute = () =>
      new Promise<WorkerOut>((resolve, reject) => {
        const handleMessage = (event: MessageEvent<WorkerOut>) => {
          if (event.data.kind !== 'pairsEvaluated') {
            return;
          }
          cleanup();
          resolve(event.data);
        };

        const handleError = (event: ErrorEvent) => {
          cleanup();
          const reason = event.error;
          if (reason instanceof Error) {
            reject(reason);
            return;
          }
          reject(new Error(typeof reason === 'string' ? reason : 'Unknown worker error'));
        };

        const cleanup = () => {
          this.worker.removeEventListener('message', handleMessage as EventListener);
          this.worker.removeEventListener('error', handleError as EventListener);
        };

        this.worker.addEventListener('message', handleMessage as EventListener);
        this.worker.addEventListener('error', handleError as EventListener);
        this.worker.postMessage(message);
      });

    const result = this.queue.then(execute);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  terminate(): void {
    this.worker.terminate();
  }
}

type EvaluationDiagnostics = NonNullable<WorkerOut['diagnostics']>;

function addReasonCounts(
  target: EvaluationDiagnostics['rejectionReasons'],
  source: EvaluationDiagnostics['rejectionReasons'],
): void {
  for (const [reason, count] of Object.entries(source)) {
    target[reason] = (target[reason] ?? 0) + count;
  }
}

function collectSamples(entries: EvaluationDiagnostics[]): EvaluationDiagnostics['samples'] {
  const aggregated: EvaluationDiagnostics['samples'] = [];
  for (const entry of entries) {
    if (!entry.samples) {
      continue;
    }
    for (const sample of entry.samples) {
      if (aggregated && aggregated.length < 10) {
        aggregated.push(sample);
      } else {
        return aggregated;
      }
    }
  }
  return aggregated;
}

function mergeDiagnostics(
  entries: Array<EvaluationDiagnostics | undefined>,
): EvaluationDiagnostics | undefined {
  const present = entries.filter((entry): entry is EvaluationDiagnostics => Boolean(entry));
  if (present.length === 0) {
    return undefined;
  }

  const diagnostics: EvaluationDiagnostics = {
    totalPairs: present.reduce((sum, item) => sum + item.totalPairs, 0),
    accepted: present.reduce((sum, item) => sum + item.accepted, 0),
    rejectionReasons: {},
    samples: undefined,
  };

  for (const entry of present) {
    addReasonCounts(diagnostics.rejectionReasons, entry.rejectionReasons);
  }

  const samples = collectSamples(present);
  if (samples && samples.length > 0) {
    diagnostics.samples = samples;
  }

  return diagnostics;
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
}

function detectPoolSize(explicitSize?: number): number {
  if (explicitSize && explicitSize > 0) {
    return explicitSize;
  }
  const hardware =
    typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
      ? Math.max(1, navigator.hardwareConcurrency - 1)
      : 1;
  return Math.max(1, Math.min(MAX_POOL_SIZE, hardware));
}

function canSpawnWorkers(spawn: Spawnability): spawn is Spawnability & { factory: WorkerFactory } {
  if (!spawn.factory) {
    return false;
  }
  if (!spawn.allowNoGlobalWorker && typeof Worker === 'undefined') {
    return false;
  }
  return true;
}

export class SwapWorkerPool {
  private readonly threshold: number;
  private readonly spawnability: Spawnability;
  private readonly size: number;
  private adapters: WorkerAdapter[] = [];
  private terminated = false;

  constructor(options: SwapWorkerPoolOptions = {}) {
    this.threshold = options.threshold ?? CANDIDATE_WORKER_THRESHOLD;
    const factory =
      options.workerFactory ?? (typeof Worker !== 'undefined' ? defaultWorkerFactory : null);
    this.spawnability = {
      factory,
      allowNoGlobalWorker: options.workerFactory !== undefined,
    };
    this.size = detectPoolSize(options.size);
  }

  async evaluatePairs(pairs: ShiftPair[], ctx: Context): Promise<SwapCandidate[]> {
    if (this.terminated) {
      throw new Error('SwapWorkerPool has been terminated');
    }

    debugLog('workerPool.evaluatePairs:start', {
      pairCount: pairs.length,
      threshold: this.threshold,
    });

    if (!this.shouldUseWorkers(pairs.length)) {
      debugLog('workerPool.evaluatePairs:mode', { mode: 'sync' });
      return this.evaluatePairsSync(pairs, ctx);
    }

    this.ensureAdapters();
    const serializedCtx = serializeContext(ctx);
    const chunkSize = Math.max(1, Math.ceil(pairs.length / this.adapters.length));
    debugLog('workerPool.evaluatePairs:mode', {
      mode: 'worker',
      adapters: this.adapters.length,
      chunkSize,
    });
    const tasks: Array<Promise<WorkerOut>> = [];
    let workerIndex = 0;

    for (let i = 0; i < pairs.length; i += chunkSize) {
      const chunk = pairs.slice(i, i + chunkSize);
      const message: WorkerIn = {
        kind: 'evaluatePairs',
        pairs: chunk,
        ctx: serializedCtx,
      };
      const adapter = this.adapters[workerIndex % this.adapters.length]!;
      workerIndex += 1;
      tasks.push(adapter.runTask(message));
    }

    const results = await Promise.all(tasks);
    let flattened = results.flatMap((item) => item.candidates);
    let diagnostics = mergeDiagnostics(results.map((item) => item.diagnostics));

    const expectedAccepted = diagnostics?.accepted;
    const diagnosticsMismatch = diagnostics === undefined || expectedAccepted !== flattened.length;
    if (pairs.length > 0 && diagnosticsMismatch) {
      debugLog('workerPool.evaluatePairs:fallback', {
        reason: diagnostics ? 'mismatch' : 'missing-diagnostics',
        expectedAccepted,
        actualAccepted: flattened.length,
        pairCount: pairs.length,
      });
      flattened = this.evaluatePairsSync(pairs, ctx);
      diagnostics = diagnostics ?? {
        totalPairs: pairs.length,
        accepted: flattened.length,
        rejectionReasons: {},
        samples: undefined,
      };
      diagnostics.accepted = flattened.length;
    }

    debugLog('workerPool.evaluatePairs:complete', {
      candidates: flattened.length,
      diagnostics,
    });
    return flattened;
  }

  evaluatePairsSync(pairs: ShiftPair[], ctx: Context): SwapCandidate[] {
    debugLog('workerPool.evaluatePairsSync:start', { pairCount: pairs.length });
    const out: SwapCandidate[] = [];
    const rejectionReasons = new Map<SwapRejectionReason['kind'], number>();
    const samples: EvaluationDiagnostics['samples'] = [];
    let accepted = 0;
    for (const pair of pairs) {
      const evaluation = explainSwap(pair.a, pair.b, ctx);
      if (!evaluation.feasible) {
        const key = evaluation.reason.kind;
        rejectionReasons.set(key, (rejectionReasons.get(key) ?? 0) + 1);
        if (samples && samples.length < 10) {
          samples.push({ reason: evaluation.reason, shiftA: pair.a.id, shiftB: pair.b.id });
        }
        continue;
      }
      accepted += 1;
      const pressure = calculateSwapPressure(pair.a, pair.b, ctx);
      out.push({
        a: pair.a,
        b: pair.b,
        score: pressure.score,
        pressure,
        advisories: evaluation.advisories,
      });
    }
    const diagnostics: EvaluationDiagnostics | undefined = {
      totalPairs: pairs.length,
      accepted,
      rejectionReasons: Object.fromEntries(rejectionReasons.entries()),
      samples: samples && samples.length > 0 ? samples : undefined,
    };
    debugLog('workerPool.evaluatePairsSync:complete', { candidates: out.length, diagnostics });
    return out;
  }

  terminate(): void {
    if (this.terminated) {
      return;
    }
    this.adapters.forEach((adapter) => adapter.terminate());
    this.adapters = [];
    this.terminated = true;
  }

  private ensureAdapters(): void {
    if (this.adapters.length > 0 || !canSpawnWorkers(this.spawnability)) {
      return;
    }

    for (let i = 0; i < this.size; i += 1) {
      const factory = this.spawnability.factory;
      if (!factory) {
        break;
      }
      this.adapters.push(new WorkerAdapter(factory));
    }

    if (this.adapters.length === 0) {
      throw new Error('Unable to spawn worker pool');
    }
  }

  private shouldUseWorkers(candidateCount: number): boolean {
    if (!canSpawnWorkers(this.spawnability)) {
      return false;
    }
    if (this.size <= 1) {
      return false;
    }
    return candidateCount >= this.threshold;
  }
}

let singletonPool: SwapWorkerPool | null = null;

function getSingletonPool(): SwapWorkerPool {
  singletonPool ??= new SwapWorkerPool();
  return singletonPool;
}

export async function evaluatePairs(pairs: ShiftPair[], ctx: Context): Promise<SwapCandidate[]> {
  return getSingletonPool().evaluatePairs(pairs, ctx);
}

export function evaluatePairsSync(pairs: ShiftPair[], ctx: Context): SwapCandidate[] {
  return getSingletonPool().evaluatePairsSync(pairs, ctx);
}

export function terminatePool(): void {
  if (singletonPool) {
    singletonPool.terminate();
    singletonPool = null;
  }
}
