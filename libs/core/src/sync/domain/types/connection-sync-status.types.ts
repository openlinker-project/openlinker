/**
 * Connection Sync Status Types
 *
 * The per-connection sync-status read model (#2615): how much work is
 * queued for one connection, whether that queue is converging, and how
 * recently the connection's own sync state moved. Read-only - no
 * persistence of its own, composed from `sync_jobs` and
 * `connection_cursors`, both of which this context already owns.
 *
 * @module libs/core/src/sync/domain/types
 */

/**
 * Backlog status values.
 */
export const ConnectionBacklogStatusValues = [
  'idle',
  'draining',
  'growing',
  'failing',
  'backlogged',
  'unknown',
] as const;

/**
 * Backlog Status
 *
 * - `'idle'`: nothing is queued for this connection.
 * - `'draining'`: work is queued and the queue is converging - at least as
 *   many jobs succeeded as arrived over the observation window. A deep queue
 *   right after an operator triggers a full sweep reads `'growing'`, because
 *   in that first hour arrival necessarily outruns drain.
 * - `'growing'`: the queue is not converging, but it has not yet crossed
 *   the derived alert threshold. Worth watching, not worth a red banner.
 * - `'failing'`: nothing succeeded in the window and at least one job died.
 *   Its own state because the queue depth says nothing useful here: a
 *   connection whose every job fails fast drains its queue and would
 *   otherwise read healthy.
 * - `'backlogged'`: the alert. The queue is not converging, it holds more
 *   work than this connection drains in the alert horizon, AND its oldest
 *   queued job has already waited longer than that horizon. All three are
 *   required - see `classifyConnectionBacklog` for why.
 * - `'unknown'`: the counts could not be read. Distinct on purpose: an
 *   infrastructure failure must never be reported as a healthy queue, and
 *   must never assert a claim about the operator's backlog either.
 */
export type ConnectionBacklogStatus = (typeof ConnectionBacklogStatusValues)[number];

/**
 * Observation window over which arrival and drain rates are measured.
 *
 * One hour is long enough that a single slow job does not swing the drain
 * rate, and short enough that a queue which started converging an hour ago
 * is already reported as converging.
 */
export const BACKLOG_OBSERVATION_WINDOW_MS = 60 * 60 * 1000;

/**
 * Alert horizon. The derived alert threshold is "the work this connection
 * drains in this much time", and the oldest queued job must also have waited
 * this long before anything alerts.
 *
 * A day is chosen because that is the point at which a backlog stops being
 * a scheduling artefact and starts meaning the operator's data is wrong -
 * stock and orders that should have moved have not moved for a business day.
 */
export const BACKLOG_ALERT_HORIZON_MS = 24 * 60 * 60 * 1000;

/**
 * How far back the historical figures look, and the bound on the rows the
 * aggregate reads.
 *
 * `sync_jobs` has no retention anywhere in the tree, so a connection taking
 * sweep children every twenty minutes accumulates millions of rows inside a
 * year. Without this bound the read would touch every one of them. A week is
 * far longer than any retry ladder (10 attempts backing off to 6 h tops out
 * around two days), so no job can complete outside it and be missed as drain.
 */
export const BACKLOG_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Absolute floor, in jobs, under which the derived threshold never alerts.
 *
 * The derived threshold is a measurement, and it is 0 whenever nothing
 * succeeded in the window. Without a floor, "the queue holds more than the
 * threshold" degenerates into "the queue is not empty", and a single job
 * waiting on its own retry backoff would raise the alert on a healthy
 * install.
 */
export const BACKLOG_MIN_ALERT_JOBS = 10;

/**
 * Raw counts for one connection over the observation window, as the
 * repository reads them. Every field is a measurement; no policy is applied
 * here.
 */
export interface ConnectionBacklogStats {
  /**
   * Jobs currently `queued` and DUE - `nextRunAt` at or before now. A job
   * waiting on its own retry backoff is not queue depth: nothing is holding
   * it up, its own schedule is, so counting it would report a failing job as
   * a stalled worker.
   */
  queuedCount: number;
  /** Jobs `queued` with a future `nextRunAt` - waiting on retry backoff. */
  deferredCount: number;
  /** Jobs currently `running` for this connection. */
  runningCount: number;
  /**
   * Jobs that died inside the history window - exhausted their retries.
   * Windowed like every other historical figure, so it clears with age
   * instead of keeping a note on the panel forever.
   */
  deadCount: number;
  /** Jobs created for this connection inside the window. */
  arrivedInWindow: number;
  /**
   * Jobs that succeeded inside the window. This is the drain measurement, and
   * it deliberately excludes `dead`: work that died was not cleared, and
   * counting it as drain gave a fast-failing connection a high drain rate and
   * a high alert threshold.
   */
  succeededInWindow: number;
  /** Jobs that died inside the observation window. */
  deadInWindow: number;
  /**
   * When this connection last completed a job successfully, or null when it
   * did not inside the history window. Business failures are excluded
   * (ADR-007): a succeeded-but-business-failed job is not a successful call.
   */
  lastSucceededAt: Date | null;
  /**
   * Mean `lastAttemptDurationMs` over terminal jobs in the window, with NULL
   * rows EXCLUDED rather than counted as zero (#2611): the column is null on
   * every row predating its migration and on any job that never completed an
   * attempt, so counting those as zero would understate every real duration.
   * `null` when no row in the window carried a duration at all.
   */
  averageAttemptDurationMs: number | null;
  /**
   * How many rows backed `averageAttemptDurationMs`. Reported so an operator
   * can tell a mean over three attempts from a mean over three thousand.
   */
  attemptDurationSampleSize: number;
  /**
   * Creation time of the oldest DUE queued job, or null when nothing is due.
   * This is queue wait, not job age in any other sense - a job in retry
   * backoff is excluded for the same reason it is excluded from the count.
   */
  oldestQueuedAt: Date | null;
}

/**
 * The derived, per-connection sync-status view.
 */
export interface ConnectionSyncStatus {
  connectionId: string;
  /** When this view was computed. */
  generatedAt: Date;
  status: ConnectionBacklogStatus;
  /**
   * True only for `'backlogged'`. Carried as its own field so a consumer
   * renders one alert without re-encoding the rule.
   */
  alerting: boolean;
  /** Queued AND due. See {@link ConnectionBacklogStats.queuedCount}. */
  queuedCount: number;
  /** Queued but waiting on retry backoff. */
  deferredCount: number;
  runningCount: number;
  /** Jobs that died inside the history window. */
  deadCount: number;
  /** Jobs that died inside the observation window. */
  deadInWindow: number;
  /** When this connection last completed a job successfully, or null. */
  lastSucceededAt: Date | null;
  /** Jobs per hour arriving for this connection, measured over the window. */
  arrivalRatePerHour: number;
  /** Jobs per hour SUCCEEDING, measured over the window. Deaths are not drain. */
  drainRatePerHour: number;
  /**
   * The derived alert threshold in jobs: the work this connection drains in
   * `BACKLOG_ALERT_HORIZON_MS` at its own measured drain rate. Never a fixed
   * number - it scales with the install.
   */
  alertThresholdJobs: number;
  /**
   * Estimated time to clear the current queue at the measured net drain rate,
   * or `null` when the queue is not converging and therefore has no estimated
   * clearance at all. Never reported as a large number in place of "never".
   */
  estimatedClearanceMs: number | null;
  /** How long the oldest queued job has been waiting, or null when nothing is queued. */
  oldestQueuedWaitMs: number | null;
  /** See {@link ConnectionBacklogStats.averageAttemptDurationMs}. */
  averageAttemptDurationMs: number | null;
  /** See {@link ConnectionBacklogStats.attemptDurationSampleSize}. */
  attemptDurationSampleSize: number;
  /**
   * When any of this connection's sync cursors last advanced, or null when it
   * holds no cursor. A connection with no cursor is not a fault: a
   * webhook-fed connection legitimately never keeps one.
   */
  lastCursorAdvanceAt: Date | null;
  /** The observation window used, so a consumer can state what the rates are over. */
  observationWindowMs: number;
  /** The alert horizon used, for the same reason. */
  alertHorizonMs: number;
  /** How far back the historical figures look, in ms. */
  historyWindowMs: number;
}
