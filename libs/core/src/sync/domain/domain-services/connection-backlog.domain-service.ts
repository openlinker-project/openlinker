/**
 * Connection Backlog Domain Service
 *
 * Pure functions deriving the per-connection backlog signal from measured
 * counts (#2615). No I/O, no ports, no framework - every input is a value the
 * caller already resolved.
 *
 * @module libs/core/src/sync/domain/domain-services
 */
import type {
  ConnectionBacklogStats,
  ConnectionBacklogStatus,
} from '../types/connection-sync-status.types';

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Convert a count over a window into a per-hour rate. A zero or negative
 * window yields 0 rather than dividing by zero.
 */
export function toRatePerHour(count: number, windowMs: number): number {
  if (windowMs <= 0) {
    return 0;
  }
  return count / (windowMs / MS_PER_HOUR);
}

/**
 * Derive the alert threshold, in jobs, from the connection's own measured
 * drain rate: the amount of work it clears in the alert horizon.
 *
 * This is the whole point of the read. A fixed number is wrong for every
 * install - 500 queued jobs is a crisis on a shop that drains 20 an hour and
 * twenty minutes of work on one that drains 1500. The threshold moves with
 * the install because it is measured from the install.
 */
export function deriveAlertThresholdJobs(drainRatePerHour: number, horizonMs: number): number {
  return drainRatePerHour * (horizonMs / MS_PER_HOUR);
}

/**
 * Estimate how long the current queue takes to clear at the measured NET
 * drain rate (drain minus arrival).
 *
 * Returns `null` when the net rate is not positive - a queue that is not
 * converging has no estimated clearance, and reporting a very large number
 * instead would dress up "never" as an estimate.
 */
export function estimateClearanceMs(
  queuedCount: number,
  drainRatePerHour: number,
  arrivalRatePerHour: number
): number | null {
  if (queuedCount === 0) {
    return 0;
  }
  const netDrainPerHour = drainRatePerHour - arrivalRatePerHour;
  if (netDrainPerHour <= 0) {
    return null;
  }
  return (queuedCount / netDrainPerHour) * MS_PER_HOUR;
}

/**
 * Compute the mean attempt duration from a summed total and the number of
 * rows that actually carried a duration.
 *
 * `lastAttemptDurationMs` is nullable - null on every row predating its
 * migration and on any job that never completed an attempt - so the divisor
 * must be the count of NON-NULL rows, never the count of jobs (#2611). With
 * no non-null rows the answer is `null`, not zero: "nothing measured" and
 * "measured as instant" are different facts.
 */
export function averageAttemptDuration(
  totalDurationMs: number,
  nonNullSampleSize: number
): number | null {
  if (nonNullSampleSize <= 0) {
    return null;
  }
  return totalDurationMs / nonNullSampleSize;
}

/**
 * Classify a connection's backlog.
 *
 * Alerting requires all three of:
 *
 * 1. The queue is NOT converging - at least as much work arrived as drained
 *    over the window.
 * 2. The queue holds more than the derived threshold, i.e. more work than
 *    this connection drains in the alert horizon.
 * 3. The oldest queued job has already waited longer than that horizon.
 *
 * Condition 3 is what keeps the alert honest. An operator who triggers a full
 * catalogue sweep enqueues thousands of jobs in one minute, which satisfies
 * conditions 1 and 2 immediately while nothing is actually wrong. Those jobs
 * are young, so condition 3 fails and the connection reads `'growing'` until
 * the wait is genuinely a day old. An alert that fires on a healthy install is
 * worse than no alert, because the next real one gets ignored.
 *
 * A drain rate of zero is treated as evidence, not as missing data: nothing
 * finished in the last hour, jobs have waited a day, and the queue is not
 * empty is precisely the stuck case this read exists to surface. `'unknown'`
 * is reserved for a failure to read the counts at all, and is produced by the
 * caller rather than here.
 */
export function classifyConnectionBacklog(input: {
  queuedCount: number;
  arrivalRatePerHour: number;
  drainRatePerHour: number;
  alertThresholdJobs: number;
  oldestQueuedWaitMs: number | null;
  alertHorizonMs: number;
}): ConnectionBacklogStatus {
  if (input.queuedCount === 0) {
    return 'idle';
  }
  const converging = input.drainRatePerHour > input.arrivalRatePerHour;
  if (converging) {
    return 'draining';
  }
  const overThreshold = input.queuedCount > input.alertThresholdJobs;
  const waitedLongEnough =
    input.oldestQueuedWaitMs !== null && input.oldestQueuedWaitMs > input.alertHorizonMs;
  return overThreshold && waitedLongEnough ? 'backlogged' : 'growing';
}

/**
 * Convenience reducer used by the application service: turn raw stats into the
 * three derived rate figures plus the status, in one pure step so the service
 * holds no policy of its own.
 */
export function deriveBacklogSignal(
  stats: ConnectionBacklogStats,
  now: Date,
  windowMs: number,
  horizonMs: number
): {
  status: ConnectionBacklogStatus;
  arrivalRatePerHour: number;
  drainRatePerHour: number;
  alertThresholdJobs: number;
  estimatedClearanceMs: number | null;
  oldestQueuedWaitMs: number | null;
} {
  const arrivalRatePerHour = toRatePerHour(stats.arrivedInWindow, windowMs);
  const drainRatePerHour = toRatePerHour(stats.completedInWindow, windowMs);
  const alertThresholdJobs = deriveAlertThresholdJobs(drainRatePerHour, horizonMs);
  const oldestQueuedWaitMs =
    stats.oldestQueuedAt === null ? null : now.getTime() - stats.oldestQueuedAt.getTime();

  return {
    status: classifyConnectionBacklog({
      queuedCount: stats.queuedCount,
      arrivalRatePerHour,
      drainRatePerHour,
      alertThresholdJobs,
      oldestQueuedWaitMs,
      alertHorizonMs: horizonMs,
    }),
    arrivalRatePerHour,
    drainRatePerHour,
    alertThresholdJobs,
    estimatedClearanceMs: estimateClearanceMs(
      stats.queuedCount,
      drainRatePerHour,
      arrivalRatePerHour
    ),
    oldestQueuedWaitMs,
  };
}
