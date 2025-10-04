const STORAGE_KEY = 'swapfinder:debug';
const CHANNEL = '[swap-finder]';

function readPreference(): boolean | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') {
      return null;
    }
    const value = globalThis.localStorage.getItem(STORAGE_KEY);
    if (value == null) {
      return null;
    }
    return value !== 'false' && value !== '0';
  } catch (_error) {
    // Access to localStorage can throw (e.g., security restrictions). Ignore and fall back.
    return null;
  }
}

let cachedPreference = readPreference();

function resolveDefault(): boolean {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch (_error) {
    return true;
  }
}

function isDebugEnabled(): boolean {
  if (cachedPreference != null) {
    return cachedPreference;
  }
  return resolveDefault();
}

export function setDebugLogging(enabled: boolean): void {
  cachedPreference = enabled;
  try {
    if (typeof globalThis.localStorage !== 'undefined') {
      globalThis.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    }
  } catch (_error) {
    // Ignore storage errors; preference will persist in-memory for session.
  }
}

type DebugPayload = unknown | (() => unknown);

function resolvePayload(payload: DebugPayload | undefined): unknown {
  if (typeof payload === 'function') {
    try {
      return (payload as () => unknown)();
    } catch (error) {
      return { error: (error as Error | undefined)?.message ?? error };
    }
  }
  return payload;
}

export function debugLog(topic: string, payload?: DebugPayload): void {
  if (!isDebugEnabled()) {
    return;
  }
  const data = resolvePayload(payload);
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info(`${CHANNEL} ${topic}`, data);
  }
}

export function debugGroup(topic: string, payload?: DebugPayload): void {
  if (!isDebugEnabled()) {
    return;
  }
  const data = resolvePayload(payload);
  debugLog(`▶ ${topic}`, data);
}

export function debugGroupEnd(topic?: string): void {
  if (!isDebugEnabled()) {
    return;
  }
  debugLog(`◀ ${topic ?? 'group-end'}`);
}

export function withDebugGroup<T>(topic: string, payload: DebugPayload, fn: () => T): T {
  if (!isDebugEnabled()) {
    return fn();
  }
  debugGroup(topic, payload);
  try {
    return fn();
  } finally {
    debugGroupEnd(topic);
  }
}

export function debugError(topic: string, payload?: DebugPayload): void {
  if (!isDebugEnabled()) {
    return;
  }
  const data = resolvePayload(payload);
  if (typeof console !== 'undefined' && typeof console.error === 'function') {
    console.error(`${CHANNEL} ${topic}`, data);
  } else {
    debugLog(topic, data);
  }
}

export function getDebugChannel(): string {
  return CHANNEL;
}
