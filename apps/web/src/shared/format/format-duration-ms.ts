/**
 * Duration Formatter
 *
 * Renders a millisecond duration for operator reading (#2611). Used by the
 * sync-jobs list and detail surfaces, which both show how long a job's last
 * attempt took.
 *
 * `null` returns `null`, never `'0 ms'`. A job whose duration was never
 * measured - every row predating the column, and any job killed before it
 * executed - must read as absent, or an operator scanning the list would
 * conclude those jobs ran instantly. Callers render their own absent marker.
 *
 * A zero measurement IS a real answer (a handler that no-opped) and renders as
 * `0 ms`, so absence and instant are distinguishable.
 *
 * @module apps/web/src/shared/format
 */

export function formatDurationMs(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) {
    return null;
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 60) {
    // One decimal below a minute: the difference between 1.2 s and 1.8 s is
    // the kind of thing this column exists to show.
    return `${seconds.toFixed(1)} s`;
  }
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${totalSeconds % 60}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
