/**
 * Ingestion Trust Domain Service
 *
 * Pure, framework-independent functions for classifying a connection's
 * ingestion status and estimating a cron expression's fire interval
 * (#1982). No I/O, no repository/port access — every input is a value
 * already resolved by the caller.
 *
 * @module libs/core/src/analytics-trust/domain/domain-services
 */
import { CronTime } from 'cron';
import type { ConnectionIngestionStatus } from '../types/connection-ingestion-trust.types';

/**
 * Classify a connection's ingestion status from its last successful
 * ingestion time and staleness threshold.
 *
 * - `null` last-success → `'never-ingested'` (distinguishable from a
 *   connection that ingested and then stalled — #1982 AC2).
 * - A `null` `staleAfterMs` means the cadence is unknown (no matching
 *   scheduler task registered for the connection's platform) — such a
 *   connection can never be classified `'stalled'`, only `'fresh'` once it
 *   has ingested at least once.
 * - Otherwise `'stalled'` when the age of the last success exceeds
 *   `staleAfterMs`, else `'fresh'`.
 */
export function classifyIngestionStatus(
  lastSuccessfulIngestionAt: Date | null,
  staleAfterMs: number | null,
  now: Date
): ConnectionIngestionStatus {
  if (lastSuccessfulIngestionAt === null) {
    return 'never-ingested';
  }
  if (staleAfterMs === null) {
    return 'fresh';
  }
  const ageMs = now.getTime() - lastSuccessfulIngestionAt.getTime();
  return ageMs > staleAfterMs ? 'stalled' : 'fresh';
}

/**
 * Estimate the interval (in milliseconds) between successive fires of a
 * cron expression, computed as the gap between the next two fire times
 * from `now`. Correctly handles the fixed-interval expressions every
 * registered order-poll scheduler task uses today (`*\/N * * * *`); an
 * irregular expression (e.g. fixed times of day) would report the gap
 * between those two specific fires rather than a true average interval —
 * a known, currently-inapplicable limitation (#1982).
 *
 * Returns `null` on a malformed cron expression rather than throwing — a
 * parse failure must degrade one connection's `expectedIntervalMs`, never
 * crash the whole read.
 */
export function estimateCronIntervalMs(cronExpression: string, now: Date): number | null {
  try {
    const cronTime = new CronTime(cronExpression);
    const first = cronTime.getNextDateFrom(now);
    const second = cronTime.getNextDateFrom(first.toJSDate());
    return second.toMillis() - first.toMillis();
  } catch {
    return null;
  }
}
