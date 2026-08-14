/**
 * Connection Ingestion Trust Types
 *
 * Defines the shape of the analytics data-trust read: per-OrderSource-
 * connection poll liveness, order-data recency, and stalled-ingestion status
 * (#1982). These are pure read-model types — no persistence of their own,
 * composed from existing sync-job and connection state.
 *
 * @module libs/core/src/analytics-trust/domain/types
 */
import type { ConnectionStatus } from '@openlinker/core/identifier-mapping';

/**
 * Connection Ingestion Status Values
 *
 * Runtime array of all valid ingestion-status values. Used for validation
 * and Swagger documentation.
 */
export const ConnectionIngestionStatusValues = [
  'never-ingested',
  'fresh',
  'stalled',
  'disconnected',
  'unknown',
] as const;

/**
 * Connection Ingestion Status
 *
 * Derived union type from ConnectionIngestionStatusValues.
 *
 * - `'never-ingested'`: no succeeded `marketplace.orders.poll` job has ever
 *   run for this connection.
 * - `'fresh'`: the last succeeded poll job is within the connection's
 *   expected polling cadence (or cadence is unknown).
 * - `'stalled'`: the last succeeded poll job is older than the connection's
 *   staleness threshold.
 * - `'disconnected'`: the connection's own `status` is not `'active'` (e.g.
 *   `needs_reauth` after an expired Allegro token, `disabled`, `error`) —
 *   takes priority over whatever the poll history would otherwise say,
 *   since a connection the platform itself has flagged as unreachable is
 *   never `'fresh'` regardless of how recently it last polled.
 * - `'unknown'`: this connection's entry could not be computed (e.g. a
 *   transient repository error) — distinct from `'never-ingested'` on
 *   purpose, since the latter is a claim about the operator's data, not
 *   about infrastructure availability. Never assert `'never-ingested'` for
 *   a connection whose real ingestion history could not be read.
 */
export type ConnectionIngestionStatus = (typeof ConnectionIngestionStatusValues)[number];

/**
 * Staleness threshold multiplier applied to a connection's expected poll
 * interval (`staleAfterMs = max(expectedIntervalMs * STALE_THRESHOLD_MULTIPLIER, MIN_STALE_THRESHOLD_MS)`).
 * Three missed ticks absorbs one worst-case processing delay plus jitter
 * without false-positiving on a slow-but-alive poller, while still catching
 * a genuinely dead poll well before it looks like a multi-day outage.
 */
export const STALE_THRESHOLD_MULTIPLIER = 3;

/**
 * Floor applied to `staleAfterMs` regardless of the multiplier result.
 * A tight-cadence poll (e.g. Allegro at 5 min) is not affected by this floor
 * (15 min > 30 min is false, so the multiplier result stands... see
 * `computeStaleAfterMs`). A slow, backstop-only poll (e.g. PrestaShop's
 * 10-min reconciliation sweep, which exists precisely because webhooks are
 * the primary path there) would otherwise threshold at 30 min, well inside
 * normal worker-queue backpressure — this floor keeps a backstop poll from
 * false-positiving a healthy webhook-fed connection into `'stalled'`.
 */
export const MIN_STALE_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Connection Ingestion Trust
 *
 * Per-connection projection of the data-trust facts: poll-pipe liveness,
 * order-data recency, connection age, and stalled status.
 */
export interface ConnectionIngestionTrust {
  connectionId: string;
  connectionName: string;
  platformType: string;
  /**
   * The connection's own current status (`active | disabled | error |
   * needs_reauth`), carried through unchanged so a `'disconnected'` status
   * entry can tell the operator *why* — never derived from poll history.
   */
  connectionStatus: ConnectionStatus;
  /**
   * `'disconnected'` when `connectionStatus !== 'active'`; otherwise
   * derived from `lastPollAt` vs. `staleAfterMs` — pipe liveness, not data
   * recency.
   */
  status: ConnectionIngestionStatus;
  /**
   * Completion time of the most recently succeeded `marketplace.orders.poll`
   * job, or null when it has never succeeded. This is a liveness signal for
   * the ingestion pipe itself ("is the poll tick still running"), not proof
   * that any order data has actually arrived — see `lastOrderIngestedAt`.
   */
  lastPollAt: Date | null;
  /**
   * Completion time of the most recently succeeded `marketplace.order.sync`
   * job for this connection, or null when none has ever succeeded. This is
   * the actual order-data-recency signal and is deliberately NOT
   * thresholded against `staleAfterMs`: a low-volume connection can go days
   * without a new order and still be perfectly healthy.
   */
  lastOrderIngestedAt: Date | null;
  /**
   * This connection's own `createdAt` — when the operator configured it,
   * NOT a claim about when its earliest order data begins (a connection can
   * legitimately ingest orders placed before it was created, e.g. Allegro's
   * event journal seeded from the beginning; conversely a connection stuck
   * in `needs_reauth` for months has ingested nothing for most of its age).
   * Renamed from `coverageStartAt` — the field never supported a "coverage
   * window" claim.
   */
  connectionCreatedAt: Date;
  /**
   * `MIN(COALESCE(placedAt, createdAt))` over this connection's
   * `order_records` (#2083) — the real per-channel coverage-window fact
   * `connectionCreatedAt` was never able to support (a connection can
   * legitimately ingest orders placed before it was created). `null` when
   * the connection has zero ingested orders — distinct from a non-null
   * value that merely predates the #1985 `placedAt` backfill (which
   * resolves to its `createdAt`-derived fallback instead).
   */
  earliestOrderDate: Date | null;
  /** Expected interval (ms) between poll ticks, derived from the connection's *enabled* registered poll cadence. Null when no matching, enabled scheduler task is registered. */
  expectedIntervalMs: number | null;
  /**
   * Staleness threshold (ms), see `computeStaleAfterMs`. Falls back to
   * `MIN_STALE_THRESHOLD_MS` when `expectedIntervalMs` is null (cadence
   * unknown), so an ancient `lastPollAt` on a connection with no known
   * cadence still eventually reads `'stalled'` rather than `'fresh'`
   * forever — never actually null in a value this service produces, kept
   * nullable on the type for callers/tests that construct one directly.
   */
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
  /**
   * The single worst status across `connections` (see
   * `computeWorstStatus`), so a consumer can render one banner without
   * re-encoding the severity ordering itself. `'fresh'` when `connections`
   * is empty — mirrors `DevStackHealthResponse.status` in `apps/api/src/health/`.
   */
  worstStatus: ConnectionIngestionStatus;
  connections: ConnectionIngestionTrust[];
}
