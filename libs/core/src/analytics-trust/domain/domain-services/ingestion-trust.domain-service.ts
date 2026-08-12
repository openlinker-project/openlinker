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
 * *poll* time and staleness threshold. This is a pipe-liveness signal
 * ("is the poll tick still running"), deliberately not a data-recency
 * signal — see `ConnectionIngestionTrust.lastOrderIngestedAt` for that.
 *
 * - `null` last-success → `'never-ingested'` (distinguishable from a
 *   connection that ingested and then stalled — #1982 AC2).
 * - A `null` `staleAfterMs` means the cadence is unknown (no matching,
 *   *enabled* scheduler task registered for the connection's platform) —
 *   such a connection can never be classified `'stalled'`, only `'fresh'`
 *   once it has ingested at least once.
 * - Otherwise `'stalled'` when the age of the last success exceeds
 *   `staleAfterMs`, else `'fresh'`.
 */
export function classifyIngestionStatus(
  lastPollAt: Date | null,
  staleAfterMs: number | null,
  now: Date
): ConnectionIngestionStatus {
  if (lastPollAt === null) {
    return 'never-ingested';
  }
  if (staleAfterMs === null) {
    return 'fresh';
  }
  const ageMs = now.getTime() - lastPollAt.getTime();
  return ageMs > staleAfterMs ? 'stalled' : 'fresh';
}

/**
 * Compute the staleness threshold from an expected poll interval: the
 * interval times a fixed multiplier, floored at `floorMs` so a slow,
 * backstop-only poll (e.g. a 10-min reconciliation sweep that exists
 * precisely because webhooks are the primary ingestion path on that
 * platform) doesn't false-positive a healthy connection into `'stalled'`
 * just because its own poll cadence is naturally loose.
 */
export function computeStaleAfterMs(
  expectedIntervalMs: number,
  multiplier: number,
  floorMs: number
): number {
  return Math.max(expectedIntervalMs * multiplier, floorMs);
}

/**
 * Estimate the interval (in milliseconds) between successive fires of a
 * cron expression, computed as the gap between the next two fire times
 * from `now`. Correctly handles the fixed-interval expressions every
 * registered order-poll scheduler task uses today (`*\/N * * * *`); an
 * irregular expression (e.g. `0 3,15 * * *`, fixed times of day) would
 * report the gap between whichever two fires are next from `now`, which
 * can be the shorter of the two real gaps depending on when `now` falls,
 * rather than a true average interval. A known, currently-inapplicable
 * limitation (#1982): no registered scheduler task uses an irregular
 * expression today, so no connection's staleness threshold is affected.
 * Also resolves in the process-local timezone (`cron`'s `CronTime` takes
 * no explicit TZ here) — irrelevant for every `*\/N` expression registered
 * today, since a fixed-minute interval doesn't shift across zones.
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

/**
 * Severity ordering for `ConnectionIngestionStatus`, worst-first-if-tied.
 * `'unknown'` outranks `'stalled'` — a build failure means the endpoint
 * cannot even vouch for "this looks broken," which is a worse trust
 * position than a confirmed-stalled read. `'never-ingested'` outranks
 * `'fresh'` since a caller reading the roll-up wants to know at least one
 * connection has no data yet, even though that's often benign (a
 * brand-new connection).
 */
const STATUS_SEVERITY: Record<ConnectionIngestionStatus, number> = {
  fresh: 0,
  'never-ingested': 1,
  stalled: 2,
  unknown: 3,
};

/**
 * Reduce a list of per-connection statuses to the single worst one, so a
 * consumer (the FE trust banner) doesn't have to re-encode the severity
 * ordering itself — mirrors `DevStackHealthResponse.status`, computed the
 * same way one directory over in `apps/api/src/health/`.
 *
 * An empty list (no OrderSource connections at all, e.g. a day-one
 * instance) reports `'fresh'` — there is nothing to distrust yet.
 */
export function computeWorstStatus(
  statuses: readonly ConnectionIngestionStatus[]
): ConnectionIngestionStatus {
  return statuses.reduce<ConnectionIngestionStatus>(
    (worst, status) => (STATUS_SEVERITY[status] > STATUS_SEVERITY[worst] ? status : worst),
    'fresh'
  );
}
