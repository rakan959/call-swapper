import { describe, expect, it, afterEach, vi } from 'vitest';

const STORAGE_KEY = 'swapfinder:debug';

type MockStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
  clear: () => void;
};

function createMockStorage(initial: Record<string, string> = {}): MockStorage {
  const store = new Map(Object.entries(initial));
  return {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

const originalConsole = { ...console };

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(console, originalConsole);
  delete (globalThis as { localStorage?: MockStorage }).localStorage;
});

async function importDebugModule(
  initialStorage: Record<string, string> = {},
  storageOverride?: MockStorage,
) {
  vi.resetModules();
  const storage = storageOverride ?? createMockStorage(initialStorage);
  (globalThis as { localStorage?: MockStorage }).localStorage = storage;
  const mod = await import('@utils/debug');
  return { mod, storage };
}

describe('debug utilities', () => {
  it('respects stored disabled preference from localStorage', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { mod } = await importDebugModule({ [STORAGE_KEY]: 'false' });

    mod.debugLog('topic', 'payload');

    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('persists preference changes to localStorage', async () => {
    const { mod, storage } = await importDebugModule();

    mod.setDebugLogging(true);
    expect(storage.getItem(STORAGE_KEY)).toBe('true');

    mod.setDebugLogging(false);
    expect(storage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('logs payloads when debug is enabled', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { mod } = await importDebugModule();

    mod.setDebugLogging(true);
    mod.debugLog('topic', () => 'computed');

    expect(infoSpy).toHaveBeenCalledWith('[swap-finder] topic', 'computed');
  });

  it('handles payload callbacks that throw', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { mod } = await importDebugModule();

    mod.setDebugLogging(true);
    mod.debugLog('problem', () => {
      throw new Error('boom');
    });

    expect(infoSpy).toHaveBeenCalledWith('[swap-finder] problem', { error: 'boom' });
  });

  it('groups logs when enabled and falls back when console.error missing', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const originalError = console.error;
    Object.defineProperty(console, 'error', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    const { mod } = await importDebugModule();
    mod.setDebugLogging(true);

    mod.debugGroup('swap.process', () => ({ detail: 'start' }));
    mod.debugGroupEnd();
    mod.debugError('oops', () => {
      throw new Error('kaput');
    });

    expect(infoSpy).toHaveBeenNthCalledWith(1, '[swap-finder] ▶ swap.process', {
      detail: 'start',
    });
    expect(infoSpy).toHaveBeenNthCalledWith(2, '[swap-finder] ◀ group-end', undefined);
    expect(infoSpy).toHaveBeenNthCalledWith(3, '[swap-finder] oops', { error: 'kaput' });

    Object.defineProperty(console, 'error', {
      value: originalError,
      configurable: true,
      writable: true,
    });
  });

  it('routes errors through console.error when available', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { mod } = await importDebugModule();

    mod.setDebugLogging(true);
    mod.debugError('fatal', () => 'details');

    expect(errorSpy).toHaveBeenCalledWith('[swap-finder] fatal', 'details');
    expect(mod.getDebugChannel()).toBe('[swap-finder]');
  });

  it('wraps functions with debug groups when enabled', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { mod } = await importDebugModule();

    mod.setDebugLogging(true);
    const fn = vi.fn(() => 'result');
    const outcome = mod.withDebugGroup('task', { id: 42 }, fn);

    expect(outcome).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(infoSpy).toHaveBeenNthCalledWith(1, '[swap-finder] ▶ task', { id: 42 });
    expect(infoSpy).toHaveBeenNthCalledWith(2, '[swap-finder] ◀ task', undefined);
  });

  it('executes wrapped function immediately when debug disabled', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { mod } = await importDebugModule({ [STORAGE_KEY]: 'false' });

    const fn = vi.fn(() => 7);
    const result = mod.withDebugGroup('task', () => 'payload', fn);

    expect(result).toBe(7);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('swallows storage errors when persisting preference changes', async () => {
    const failingStorage: MockStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
      clear: () => {},
    };

    const { mod } = await importDebugModule({}, failingStorage);

    expect(() => mod.setDebugLogging(true)).not.toThrow();
    expect(() => mod.setDebugLogging(false)).not.toThrow();
  });
});
