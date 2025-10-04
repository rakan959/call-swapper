export function formatScore(value: number, fractionDigits = 2): string {
  const normalized = Number.isFinite(value) ? value : 0;
  const formatted = normalized.toFixed(fractionDigits);
  if (normalized > 0 && !formatted.startsWith('+')) {
    return `+${formatted}`;
  }
  return formatted;
}
