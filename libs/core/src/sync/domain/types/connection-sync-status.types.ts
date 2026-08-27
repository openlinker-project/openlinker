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
  'backlogged',
  'unknown',
] as const;

/**
 * Backlog Status
 *
 * - `'idle'`: nothing is queued for this connection.
 * - `'draining'`: work is queued and the queue is converging - more jobs
 *   finished than arrived over the observation window. A deep queue right
 *   after an operator triggers a full sweep normally reads `'draining'`.
 * - `'growing'`: the queue is not converging, but it has not yet crossed
 *   the derived alert threshold. Worth watching, not worth a red banner.
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
 * Raw counts for one connection over the observation window, as the
 * repository reads them. Every field is a measurement; no policy is applied
 * here.
 */
export interface ConnectionBacklogStats {
  /** Jobs currently `queued` for this connection, at any `nextRunAt`. */
  queuedCount: number;
  /** Jobs currently `running` for this connection. */
  runningCount: number;
  /** Jobs in `dead` status for this connection - exhausted their retries. */
  deadCount: number;
  /** Jobs created for this connection inside the window. */
  arrivedInWindow: number;
  /**
   * Jobs that reached a terminal state (`succeeded` or `dead`) inside the
   * window. This is the drain measurement.
   */
  completedInWindow: number;
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
   * Creation time of the oldest job still `queued`, or null when nothing is
   * queued. This is queue wait, not job age in any other sense.
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
  queuedCount: number;
  runningCount: number;
  deadCount: number;
  /** Jobs per hour arriving for this connection, measured over the window. */
  arrivalRatePerHour: number;
  /** Jobs per hour reaching a terminal state, measured over the window. */
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
}
