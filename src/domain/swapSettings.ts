import { defaultSortDirection, ensureSwapSortKey, SortDirection, SwapSortKey } from './swapSort';
import { debugError } from '@utils/debug';

export type SwapSettings = Readonly<{
  defaultSortKey: SwapSortKey;
  defaultSortDirection: SortDirection;
  hideNegativeResident: boolean;
  hideNegativeTotal: boolean;
}>;

export const DEFAULT_SWAP_SETTINGS: SwapSettings = {
  defaultSortKey: 'score',
  defaultSortDirection: defaultSortDirection('score'),
  hideNegativeResident: true,
  hideNegativeTotal: true,
};

const SETTINGS_COOKIE_NAME = 'swapSettings';
const SETTINGS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const isBrowser = (): boolean => typeof document !== 'undefined';

const ensureSortDirection = (value: unknown, fallback: SortDirection): SortDirection => {
  return value === 'asc' || value === 'desc' ? value : fallback;
};

const ensureBoolean = (value: unknown, fallback: boolean): boolean => {
  return typeof value === 'boolean' ? value : fallback;
};

const readCookie = (name: string): string | null => {
  if (!isBrowser()) {
    return null;
  }
  const decodedName = decodeURIComponent(name);
  const entries = document.cookie.split(';');
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }
    const cookieName = trimmed.slice(0, separatorIndex);
    if (cookieName !== decodedName) {
      continue;
    }
    return trimmed.slice(separatorIndex + 1);
  }
  return null;
};

const writeCookie = (name: string, value: string, maxAgeSeconds: number): void => {
  if (!isBrowser()) {
    return;
  }
  const encodedName = encodeURIComponent(name);
  const encodedValue = encodeURIComponent(value);
  document.cookie = `${encodedName}=${encodedValue}; max-age=${maxAgeSeconds}; path=/; samesite=lax`;
};

export const loadSwapSettings = (): SwapSettings => {
  try {
    const cookieValue = readCookie(SETTINGS_COOKIE_NAME);
    if (!cookieValue) {
      return DEFAULT_SWAP_SETTINGS;
    }
    const parsed = JSON.parse(decodeURIComponent(cookieValue)) as Partial<Record<string, unknown>>;
    const defaultSortKey = ensureSwapSortKey(
      parsed.defaultSortKey,
      DEFAULT_SWAP_SETTINGS.defaultSortKey,
    );
    const defaultSortDirection = ensureSortDirection(
      parsed.defaultSortDirection,
      DEFAULT_SWAP_SETTINGS.defaultSortDirection,
    );
    const hideNegativeResident = ensureBoolean(
      parsed.hideNegativeResident,
      DEFAULT_SWAP_SETTINGS.hideNegativeResident,
    );
    const hideNegativeTotal = ensureBoolean(
      parsed.hideNegativeTotal,
      DEFAULT_SWAP_SETTINGS.hideNegativeTotal,
    );
    return {
      defaultSortKey,
      defaultSortDirection,
      hideNegativeResident,
      hideNegativeTotal,
    };
  } catch (error) {
    debugError('swapSettings.parse-error', () => ({
      reason: error instanceof Error ? error.message : 'unknown',
    }));
    return DEFAULT_SWAP_SETTINGS;
  }
};

export const saveSwapSettings = (settings: SwapSettings): void => {
  const serialized = JSON.stringify(settings);
  writeCookie(SETTINGS_COOKIE_NAME, serialized, SETTINGS_COOKIE_MAX_AGE);
};
