import { debugLog } from '@utils/debug';

export const FALLBACK_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1rbtjSPukvOOOp5VGUPV5UV1V5d4MBPctIHxG84O5kr4/gviz/tq?tqx=out:csv&sheet=Schedule';

export const FALLBACK_ROTATION_CSV_URL =
  'https://docs.google.com/spreadsheets/d/10ti4HkWKXBCfp68Y5y2Cusfabh5i_7PEE4kR_9mgcBE/gviz/tq?tqx=out:csv&sheet=Schedule';

export type RuntimeEnv = Readonly<{
  csvUrl: string;
  rotationCsvUrl: string;
}>;

type RawEnv = {
  readonly VITE_CSV_URL?: string;
  readonly VITE_ROTATION_CSV_URL?: string;
};

let cachedEnv: RuntimeEnv | null = null;
let warnedCsvFallback = false;

function normalize(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function ensureUrl(name: string, candidate: string): string {
  try {
    new URL(candidate);
    return candidate;
  } catch (error) {
    throw new Error(`Invalid ${name} provided: ${(error as Error).message}`);
  }
}

export function resolveRuntimeEnv(rawEnv: RawEnv = import.meta.env as RawEnv): RuntimeEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const csvUrl = normalize(rawEnv.VITE_CSV_URL) ?? FALLBACK_CSV_URL;
  const rotationCsvUrl = normalize(rawEnv.VITE_ROTATION_CSV_URL) ?? FALLBACK_ROTATION_CSV_URL;

  if (csvUrl === FALLBACK_CSV_URL && !warnedCsvFallback) {
    warnedCsvFallback = true;
    debugLog('env', 'VITE_CSV_URL not set; falling back to baked-in Google Sheet URL.');
  }

  const validatedCsvUrl = ensureUrl('VITE_CSV_URL', csvUrl);
  const validatedRotationUrl = ensureUrl('VITE_ROTATION_CSV_URL', rotationCsvUrl);

  cachedEnv = {
    csvUrl: validatedCsvUrl,
    rotationCsvUrl: validatedRotationUrl,
  };

  return cachedEnv;
}

export function assertRuntimeEnv(rawEnv: RawEnv = import.meta.env as RawEnv): RuntimeEnv {
  const env = resolveRuntimeEnv(rawEnv);
  if (!env.csvUrl) {
    throw new Error('Missing required environment variable VITE_CSV_URL.');
  }
  return env;
}
