/**
 * Connection Ingestion Trust Types
 *
 * Defines the shape of the analytics data-trust read: per-OrderSource-
 * connection freshness, coverage window, and stalled-ingestion status
 * (#1982). These are pure read-model types — no persistence of their own,
 * composed from existing sync-job and connection state.
 *
 * @module libs/core/src/analytics-trust/domain/types
 */

/**
 * Connection Ingestion Status Values
 *
 * Runtime array of all valid ingestion-status values. Used for validation
 * and Swagger documentation.
 */
export const ConnectionIngestionStatusValues = ['never-ingested', 'fresh', 'stalled'] as const;

/**
 * Connection Ingestion Status
 *
 * Derived union type from ConnectionIngestionStatusValues.
 *
 * - `'never-ingested'`: no succeeded ingestion job has ever run for this
 *   connection.
 * - `'fresh'`: the last succeeded ingestion job is within the connection's
 *   expected polling cadence (or cadence is unknown).
 * - `'stalled'`: the last succeeded ingestion job is older than the
 *   connection's staleness threshold.
 */
export type ConnectionIngestionStatus = (typeof ConnectionIngestionStatusValues)[number];

/**
 * Staleness threshold multiplier applied to a connection's expected poll
 * interval (`staleAfterMs = expectedIntervalMs * STALE_THRESHOLD_MULTIPLIER`).
 * Three missed ticks absorbs one worst-case processing delay plus jitter
 * without false-positiving on a slow-but-alive poller, while still catching
 * a genuinely dead poll well before it looks like a multi-day outage.
 */
export const STALE_THRESHOLD_MULTIPLIER = 3;

/**
 * Connection Ingestion Trust
 *
 * Per-connection projection of the three data-trust facts: freshness,
 * coverage window, and stalled status.
 */
export interface ConnectionIngestionTrust {
  connectionId: string;
  connectionName: string;
  platformType: string;
  status: ConnectionIngestionStatus;
  /** Completion time of the most recently succeeded ingestion job, or null when never-ingested. */
  lastSuccessfulIngestionAt: Date | null;
  /** Start of this connection's coverage window — the connection's own createdAt. */
  coverageStartAt: Date;
  /** Expected interval (ms) between successful ingestion ticks, derived from the connection's registered poll cadence. Null when no matching scheduler task is registered. */
  expectedIntervalMs: number | null;
  /** Staleness threshold (ms) = expectedIntervalMs * STALE_THRESHOLD_MULTIPLIER. Null when expectedIntervalMs is null. */
  staleAfterMs: number | null;
}

/**
 * Analytics Trust Snapshot
 *
 * The full response for the analytics data-trust read: one entry per
 * OrderSource-capable connection, plus the time the snapshot was computed.
 */
export interface AnalyticsTrustSnapshot {
  generatedAt: Date;
  connections: ConnectionIngestionTrust[];
}
