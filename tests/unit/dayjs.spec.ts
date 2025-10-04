import { describe, expect, it } from 'vitest';

import { ACTIVE_TIMEZONE, DEFAULT_TIMEZONE, resolveConfiguredTimezone } from '@utils/dayjs';

describe('@utils/dayjs', () => {
  it('extracts timezone from supplied env', () => {
    const timezone = resolveConfiguredTimezone({ VITE_TZ: ' Europe/London ' });

    expect(timezone).toBe('Europe/London');
  });

  it('falls back to DEFAULT_TIMEZONE when env is blank', () => {
    const timezone = resolveConfiguredTimezone({ VITE_TZ: '' });

    expect(timezone).toBe(DEFAULT_TIMEZONE);
  });

  it('understands legacy VITE_DEFAULT_TIMEZONE for compatibility', () => {
    const timezone = resolveConfiguredTimezone({ VITE_DEFAULT_TIMEZONE: 'America/Chicago' });

    expect(timezone).toBe('America/Chicago');
  });

  it('uses DEFAULT_TIMEZONE when env missing', () => {
    const timezone = resolveConfiguredTimezone(undefined);

    expect(timezone).toBe(DEFAULT_TIMEZONE);
  });

  it('sets ACTIVE_TIMEZONE to the configured default on module load', () => {
    expect(ACTIVE_TIMEZONE).toBe(DEFAULT_TIMEZONE);
  });
});
