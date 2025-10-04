import { describe, expect, it, vi } from 'vitest';
import { SwapWorkerPool } from '@engine/workerPool';
import type { SwapWorkerPoolOptions } from '@engine/workerPool';
import type { WorkerIn, WorkerOut, ShiftPair } from '@engine/workerProtocol';
import { hydrateContext } from '@engine/contextTransfer';
import { isFeasibleSwap } from '@domain/rules';
import { calculateSwapPressure, proximityPressure } from '@domain/simipar';
import type { Context, Resident, Shift } from '@domain/types';
import { resolveShabbosObservers } from '@domain/shabbos';
import * as debug from '@utils/debug';
import type { SwapRejectionReason } from '@domain/rules';

type Listener<T> = (event: T) => void;

type MessageListener = Listener<MessageEvent<WorkerOut>>;
type ErrorListener = Listener<ErrorEvent>;

class BaseWorker {
  protected readonly messageListeners = new Set<MessageListener>();
  protected readonly errorListeners = new Set<ErrorListener>();
  protected terminated = false;

  addEventListener(type: 'message' | 'error', listener: MessageListener | ErrorListener): void {
    if (type === 'message') {
      this.messageListeners.add(listener as MessageListener);
    } else {
      this.errorListeners.add(listener as ErrorListener);
    }
  }

  removeEventListener(type: 'message' | 'error', listener: MessageListener | ErrorListener): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as MessageListener);
    } else {
      this.errorListeners.delete(listener as ErrorListener);
    }
  }

  protected emitMessage(response: WorkerOut): void {
    this.messageListeners.forEach((listener) =>
      listener({ data: response } as MessageEvent<WorkerOut>),
    );
  }

  protected emitError(error: unknown): void {
    this.errorListeners.forEach((listener) => listener({ error } as ErrorEvent));
  }

  terminate(): void {
    this.terminated = true;
    this.messageListeners.clear();
    this.errorListeners.clear();
  }
}

class MockWorker extends BaseWorker {
  postMessage(message: WorkerIn): void {
    if (this.terminated) {
      return;
    }

    queueMicrotask(() => {
      try {
        const ctx = hydrateContext(message.ctx);
        const candidates = message.pairs
          .filter((pair) => isFeasibleSwap(pair.a, pair.b, ctx))
          .map((pair) => {
            const pressure = calculateSwapPressure(pair.a, pair.b, ctx);
            return {
              a: pair.a,
              b: pair.b,
              score: pressure.score,
              pressure,
            };
          });

        const response: WorkerOut = {
          kind: 'pairsEvaluated',
          candidates,
          chunkSize: message.pairs.length,
          diagnostics: {
            totalPairs: message.pairs.length,
            accepted: candidates.length,
            rejectionReasons: {},
          },
        };

        this.emitMessage(response);
      } catch (error) {
        this.emitError(error);
      }
    });
  }
}

class MismatchedWorker extends BaseWorker {
  postMessage(message: WorkerIn): void {
    if (this.terminated) {
      return;
    }

    queueMicrotask(() => {
      const response: WorkerOut = {
        kind: 'pairsEvaluated',
        candidates: [],
        chunkSize: message.pairs.length,
        diagnostics: {
          totalPairs: message.pairs.length,
          accepted: message.pairs.length,
          rejectionReasons: {},
        },
      };

      this.emitMessage(response);
    });
  }
}

class NoDiagnosticsWorker extends BaseWorker {
  postMessage(message: WorkerIn): void {
    if (this.terminated) {
      return;
    }

    queueMicrotask(() => {
      const response: WorkerOut = {
        kind: 'pairsEvaluated',
        candidates: [],
        chunkSize: message.pairs.length,
      };

      this.emitMessage(response);
    });
  }
}

class SampleRichWorker extends BaseWorker {
  postMessage(message: WorkerIn): void {
    if (this.terminated) {
      return;
    }

    queueMicrotask(() => {
      const samples = message.pairs.map((pair, index) => ({
        reason: {
          kind: 'unexpected-error',
          message: `mock-${index}`,
          shiftA: pair.a.id,
          shiftB: pair.b.id,
        } satisfies SwapRejectionReason,
        shiftA: pair.a.id,
        shiftB: pair.b.id,
      }));

      const response: WorkerOut = {
        kind: 'pairsEvaluated',
        candidates: [],
        chunkSize: message.pairs.length,
        diagnostics: {
          totalPairs: message.pairs.length,
          accepted: 0,
          rejectionReasons: {},
          samples,
        },
      };

      this.emitMessage(response);
    });
  }
}

function buildResident(id: string): Resident {
  return {
    id,
    name: `Resident ${id}`,
    eligibleShiftTypes: ['MOSES', 'WEILER', 'NIGHT FLOAT'],
    rotations: [],
    academicYears: [],
  };
}

function buildShift(id: string, residentId: string, dayOffset: number): Shift {
  const start = new Date(Date.UTC(2025, 0, 6 + dayOffset, 8, 0, 0));
  const end = new Date(start);
  end.setHours(end.getHours() + 8);
  return {
    id,
    residentId,
    startISO: start.toISOString(),
    endISO: end.toISOString(),
    type: 'MOSES',
  };
}

function buildContext(shifts: Shift[], residents: Resident[]): Context {
  const residentsById = new Map(residents.map((resident) => [resident.id, resident] as const));
  const shiftsByResident = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const arr = shiftsByResident.get(shift.residentId) ?? [];
    arr.push(shift);
    shiftsByResident.set(shift.residentId, arr);
  }
  for (const [, arr] of shiftsByResident) {
    arr.sort((a, b) => a.startISO.localeCompare(b.startISO));
  }
  return {
    ruleConfig: { restHoursMin: 0, typeWhitelist: [] },
    residentsById,
    shiftsByResident,
    shabbosObservers: resolveShabbosObservers(shiftsByResident),
  };
}

describe('SwapWorkerPool', () => {
  const residents = [buildResident('A'), buildResident('B'), buildResident('C')];
  const shifts = [
    buildShift('sA1', 'A', 0),
    buildShift('sB1', 'B', 1),
    buildShift('sC1', 'C', 2),
    buildShift('sB2', 'B', 3),
  ];
  const context = buildContext(shifts, residents);
  const pairs: ShiftPair[] = [
    { a: shifts[0]!, b: shifts[1]! },
    { a: shifts[0]!, b: shifts[2]! },
    { a: shifts[0]!, b: shifts[3]! },
  ];

  it('falls back to synchronous evaluation below the threshold', async () => {
    const factory = vi.fn(() => new MockWorker() as unknown as Worker);
    const options: SwapWorkerPoolOptions = { threshold: 10, size: 3, workerFactory: factory };
    const pool = new SwapWorkerPool(options);

    const result = await pool.evaluatePairs(pairs.slice(0, 1), context);
    const expectedScore = proximityPressure(pairs[0]!.a, pairs[0]!.b, context);

    expect(factory).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0]?.score).toBeCloseTo(expectedScore, 5);

    pool.terminate();
  });

  /**
   * @req: F-010
   * @req: N-002
   */
  it('dispatches heavy workloads across the worker pool', async () => {
    const workerInstances: MockWorker[] = [];
    const factory = vi.fn(() => {
      const worker = new MockWorker();
      workerInstances.push(worker);
      return worker as unknown as Worker;
    });
    const options: SwapWorkerPoolOptions = { threshold: 2, size: 3, workerFactory: factory };
    const pool = new SwapWorkerPool(options);

    const resultPromise = pool.evaluatePairs(pairs, context);

    expect(factory).toHaveBeenCalledTimes(3);
    const result = await resultPromise;
    const expectedScores = pairs.map((pair) => proximityPressure(pair.a, pair.b, context));

    expect(result).toHaveLength(pairs.length);
    result.forEach((candidate, index) => {
      expect(candidate.score).toBeCloseTo(expectedScores[index]!, 5);
    });
    expect(workerInstances.length).toBe(3);

    pool.terminate();
  });

  it('falls back to synchronous evaluation when worker output is inconsistent', async () => {
    const factory = vi.fn(() => new MismatchedWorker() as unknown as Worker);
    const options: SwapWorkerPoolOptions = { threshold: 1, size: 2, workerFactory: factory };
    const pool = new SwapWorkerPool(options);

    const result = await pool.evaluatePairs(pairs.slice(0, 1), context);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0]?.score).toBeCloseTo(proximityPressure(pairs[0]!.a, pairs[0]!.b, context), 5);

    pool.terminate();
  });

  it('falls back to synchronous evaluation when diagnostics are missing', async () => {
    const debugSpy = vi.spyOn(debug, 'debugLog');
    const factory = vi.fn(() => new NoDiagnosticsWorker() as unknown as Worker);
    const options: SwapWorkerPoolOptions = { threshold: 1, size: 2, workerFactory: factory };
    const pool = new SwapWorkerPool(options);

    const result = await pool.evaluatePairs(pairs, context);

    expect(result).toHaveLength(pairs.length);
    expect(factory).toHaveBeenCalledTimes(2);

    const fallbackCall = debugSpy.mock.calls.find(
      ([topic]) => topic === 'workerPool.evaluatePairs:fallback',
    );
    expect(fallbackCall?.[1]).toMatchObject({ reason: 'missing-diagnostics' });

    pool.terminate();
    debugSpy.mockRestore();
  });

  it('limits diagnostic samples collected from workers', async () => {
    const debugSpy = vi.spyOn(debug, 'debugLog');
    const factory = vi.fn(() => new SampleRichWorker() as unknown as Worker);
    const options: SwapWorkerPoolOptions = { threshold: 1, size: 2, workerFactory: factory };
    const pool = new SwapWorkerPool(options);

    const extendedPairs: ShiftPair[] = Array.from({ length: 12 }, (_, index) => ({
      a: {
        ...shifts[0]!,
        id: `a-${index}`,
        residentId: `resident-a-${index}`,
      },
      b: {
        ...shifts[1]!,
        id: `b-${index}`,
        residentId: `resident-b-${index}`,
      },
    }));

    const result = await pool.evaluatePairs(extendedPairs, context);

    expect(result).toHaveLength(0);

    const completeCall = debugSpy.mock.calls.find(
      ([topic]) => topic === 'workerPool.evaluatePairs:complete',
    );
    expect(completeCall).toBeDefined();
    if (completeCall) {
      const payload = completeCall[1] as { diagnostics?: { samples?: unknown[] } };
      expect(payload.diagnostics?.samples).toHaveLength(10);
    }

    pool.terminate();
    debugSpy.mockRestore();
  });
});
