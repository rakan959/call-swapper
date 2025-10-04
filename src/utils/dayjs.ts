import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

export const DEFAULT_TIMEZONE = 'America/New_York';

export type EnvLike =
  | {
      VITE_TZ?: string | undefined;
      VITE_DEFAULT_TIMEZONE?: string | undefined;
    }
  | undefined;

export function resolveConfiguredTimezone(env: EnvLike): string {
  const candidate = env?.VITE_TZ ?? env?.VITE_DEFAULT_TIMEZONE;
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  return DEFAULT_TIMEZONE;
}

const configuredTimezone = (() => {
  try {
    const meta =
      typeof import.meta !== 'undefined'
        ? (import.meta as unknown as { env?: EnvLike }).env
        : undefined;
    return resolveConfiguredTimezone(meta);
  } catch {
    // Ignore environments where import.meta is unavailable.
  }
  return DEFAULT_TIMEZONE;
})();

dayjs.extend(utc);
dayjs.extend(timezone);

dayjs.tz.setDefault(configuredTimezone);

export const ACTIVE_TIMEZONE = configuredTimezone;

export default dayjs;
