/**
 * Subiekt Scheduler Tasks (#3358, #3370)
 *
 * Builds the `SchedulerTaskConfig` instances Subiekt contributes to the core
 * `SchedulerTaskRegistryService`. Two tasks:
 *
 *   - `subiekt-bridge-reachability-sweep` (#3358) — periodically re-probes the
 *     bridge via `ConnectionTesterPort` (the same check the connection-detail
 *     "Test connection" button and `/v1/health/dev-stack` both use), so a
 *     dead/unreachable Sfera bridge produces at least a structured, greppable
 *     log line instead of silence. No `requiredCapability` — reachability is a
 *     property of the bridge process, not of any one capability.
 *
 *   - `subiekt-orders-poll` (#3370) — the MANDATORY order-ingestion backstop
 *     for Subiekt's own `OrderSource` (native GT sales orders). Without a
 *     scheduler task nothing ever calls `OrderIngestionService`, so
 *     `OrderSourcePort.listOrderFeed` was reachable in code but never actually
 *     invoked — a connection with `OrderSource` enabled silently ingested
 *     nothing, forever. Enqueues the platform-agnostic core
 *     `marketplace.orders.poll` job (the `erli-orders-poll` #993 shape) →
 *     `OrderIngestionService` → `OrderSourcePort.listOrderFeed` → enqueue per
 *     item → `getOrder`. Watermark cursor key `subiekt.orders.dataWystawieniaCursor`
 *     (matches `BridgeOrderFeedResponse.nextCursor`'s own semantics — the max
 *     `dataWystawienia` seen in the page).
 *
 * @module libs/integrations/subiekt/src/infrastructure/scheduler
 * @see {@link SchedulerTaskConfig} in `@openlinker/core/sync`.
 */
import type { SchedulerTaskConfig } from '@openlinker/core/sync';

/** Every 5 minutes — frequent enough to bound outage-detection latency without adding meaningful load (the check itself is a single lightweight bridge HTTP call). */
const SUBIEKT_BRIDGE_REACHABILITY_SWEEP_CRON = '*/5 * * * *';

/** Every 5 minutes (matches the Erli/Allegro orders-poll cadence). */
const SUBIEKT_ORDERS_POLL_CRON = '*/5 * * * *';
/** Feed page size per poll tick. */
const SUBIEKT_ORDERS_POLL_LIMIT = 200;

export function buildSubiektSchedulerTasks(): SchedulerTaskConfig[] {
  return [
    {
      taskId: 'subiekt-bridge-reachability-sweep',
      // `subiekt-gt` must match the manifest's platformType exactly: the
      // scheduler filters connections on this value and, finding none, logs at
      // DEBUG and returns. A mismatch is therefore silent - no error, no
      // failed job, just a sweep that never runs again.
      platformType: 'subiekt-gt',
      // `jobType`, the cursor key below and the idempotency-key templates keep
      // the bare `subiekt` prefix DELIBERATELY. They are persisted values:
      // renaming jobType breaks the registered SyncJobType union, and renaming
      // the cursor key restarts the order feed from the beginning and
      // re-ingests the whole history. Identity changed; stored keys did not.
      jobType: 'subiekt.bridge.reachabilitySweep',
      cronExpression: SUBIEKT_BRIDGE_REACHABILITY_SWEEP_CRON,
      enabledEnvVar: 'OL_SUBIEKT_BRIDGE_REACHABILITY_SWEEP_SCHEDULER_ENABLED',
      generatePayload: () => ({
        schemaVersion: 1,
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `subiekt:${connection.id}:bridge:reachability:sweep:${timestamp}`,
    },
    {
      taskId: 'subiekt-orders-poll',
      platformType: 'subiekt-gt',
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.orders.poll',
      cronExpression: SUBIEKT_ORDERS_POLL_CRON,
      enabledEnvVar: 'OL_SUBIEKT_ORDERS_POLL_SCHEDULER_ENABLED',
      generatePayload: () => ({
        schemaVersion: 1,
        limit: SUBIEKT_ORDERS_POLL_LIMIT,
        cursorKey: 'subiekt.orders.dataWystawieniaCursor',
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:orders:poll:${timestamp}`,
    },
  ];
}
