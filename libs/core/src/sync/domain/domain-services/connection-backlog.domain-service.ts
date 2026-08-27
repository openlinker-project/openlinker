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
import { BACKLOG_MIN_ALERT_JOBS } from '../types/connection-sync-status.types';

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
 * Classify a connection's backlog.
 *
 * The alert requires all four of:
 *
 * 1. The queue is NOT converging - more work arrived than succeeded over the
 *    observation window.
 * 2. The DUE queue holds more than the derived threshold, and more than an
 *    absolute floor. The floor is what stops a measured threshold of 0 from
 *    turning condition 2 into "the queue is not empty".
 * 3. The oldest DUE job has already waited longer than the alert horizon.
 * 4. Something has actually succeeded in the window. With nothing succeeding,
 *    the honest reading is `'failing'`, not a backlog: no rate was measured,
 *    so no rate-derived claim can be made.
 *
 * Condition 3 is what keeps the alert honest about sweeps. An operator who
 * triggers a full catalogue sweep enqueues thousands of jobs in one minute,
 * satisfying conditions 1 and 2 immediately while nothing is wrong. Those
 * jobs are young, so condition 3 fails and the connection reads `'growing'`
 * until the wait is genuinely a day old.
 *
 * Conditions 2 and 4 are what keep it honest about retries. A job that fails
 * is requeued with a future `nextRunAt` and its original `createdAt`, so on a
 * quiet connection one such job used to satisfy every condition and print the
 * red banner while the worker was perfectly healthy. It is now excluded from
 * the due count upstream, and even if it were not, the floor and the
 * measured-drain requirement would each block the alert on their own.
 *
 * `'unknown'` is reserved for a failure to read the counts at all, and is
 * produced by the caller rather than here.
 */
export function classifyConnectionBacklog(input: {
  queuedCount: number;
  arrivalRatePerHour: number;
  drainRatePerHour: number;
  alertThresholdJobs: number;
  oldestQueuedWaitMs: number | null;
  alertHorizonMs: number;
  succeededInWindow: number;
  deadInWindow: number;
}): ConnectionBacklogStatus {
  const nothingSucceeded = input.succeededInWindow === 0;
  if (nothingSucceeded && input.deadInWindow > 0) {
    return 'failing';
  }
  if (input.queuedCount === 0) {
    return 'idle';
  }
  // A tie is convergence: in steady state arrival equals drain, and calling
  // that "not converging" put the warning badge on normal operation. A zero
  // drain rate is not, even against zero arrival - nothing is moving, so
  // nothing is catching up.
  const converging =
    input.drainRatePerHour > 0 && input.drainRatePerHour >= input.arrivalRatePerHour;
  if (converging) {
    return 'draining';
  }
  const effectiveThreshold = Math.max(input.alertThresholdJobs, BACKLOG_MIN_ALERT_JOBS);
  const overThreshold = input.queuedCount > effectiveThreshold;
  const waitedLongEnough =
    input.oldestQueuedWaitMs !== null && input.oldestQueuedWaitMs > input.alertHorizonMs;
  return !nothingSucceeded && overThreshold && waitedLongEnough ? 'backlogged' : 'growing';
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
  const drainRatePerHour = toRatePerHour(stats.succeededInWindow, windowMs);
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
      succeededInWindow: stats.succeededInWindow,
      deadInWindow: stats.deadInWindow,
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
