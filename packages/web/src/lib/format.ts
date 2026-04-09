/**
 * Format milliseconds to human-readable duration string.
 *
 * < 1000ms   → '0s'
 * < 60000ms  → 'Xs'       (e.g. '45s')
 * < 3600000ms → 'Xm Ys'  (e.g. '7m 1s'), omit seconds if 0
 * ≥ 3600000ms → 'Xh Ym'  omit minutes if 0
 *
 * Handles 60s rounding carry (59.5s rounds to 1m not 60s).
 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);

  if (totalSeconds < 1) {
    return '0s';
  }

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  if (totalMinutes < 60) {
    if (remainingSeconds === 0) {
      return `${totalMinutes}m`;
    }
    return `${totalMinutes}m ${remainingSeconds}s`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  if (remainingMinutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Format a number in compact notation.
 *
 * < 1000     → '999'   (plain number)
 * ≥ 1000     → '1.3k'  (compact, lowercase, 1 decimal)
 * ≥ 1000000  → '2.5m'
 */
export function formatNumber(n: number): string {
  if (n < 1000) {
    return String(n);
  }

  const formatted = new Intl.NumberFormat('en', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(n);

  // Intl outputs 'K' / 'M' / 'B' — convert to lowercase
  return formatted.toLowerCase();
}
