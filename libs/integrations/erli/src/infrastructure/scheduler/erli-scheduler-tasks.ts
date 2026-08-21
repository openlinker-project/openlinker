/**
 * Erli Scheduler Tasks
 *
 * Builds the `SchedulerTaskConfig` instances Erli contributes to the core
 * `SchedulerTaskRegistryService`. Two tasks today:
 *
 *   - `erli-offer-status-sync` (#989) — steady-state refresh of mapped Erli
 *     offers' publication status into `offer_status_snapshots` (the reconciliation
 *     that turns an async-202 "submitted" into the real accepted/active/inactive/
 *     rejected status — ADR-025 §1). Default hourly. Rolling scan-offset cursor
 *     key `erli.offerStatus.scanOffset`. Reuses the platform-agnostic core
 *     `marketplace.offer.statusSync` job + `OfferStatusSyncService`, which resolve
 *     the Erli adapter via the `OfferStatusReader` capability (#989) — no new
 *     worker handler.
 *
 *   - `erli-orders-poll` (#993) — the MANDATORY order-ingestion backstop. Erli
 *     webhooks fire-once with no retry (ADR-025 §1), so a missed/dropped webhook
 *     would otherwise silently lose the order. Enqueues the platform-agnostic core
 *     `marketplace.orders.poll` job, which drives `OrderIngestionService` →
 *     `OrderSourcePort.listOrderFeed` (the Erli inbox poll, #993) → enqueue →
 *     `getOrder`. Default every 5 min (matches the Allegro orders-poll cadence).
 *     Inbox-message-id cursor key `erli.orders.inboxCursor`. Env gate
 *     `OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED`.
 *
 * Unlike the Allegro tasks (which read cron/page-size overrides off a NestJS
 * `ConfigService`), Erli is wired via `createNestAdapterModule` and has no
 * plugin-scoped `ConfigService`, so this builder takes no config.
 *
 * **Both tasks default ON (#2230).** Registration is unconditional; each task
 * carries its own `enabledEnvVar`, which the scheduler re-reads at every tick and
 * which disables the task only on the literal string `'false'`. So an absent env
 * var means enabled, matching Allegro.
 *
 * The offer-status task was strict opt-in until #2230 (review #1063), guarding
 * against a `status` wire field that was still #992-provisional: had the real GET
 * response not carried it with the expected values, `mapErliStatusToReadResult`
 * would fall through to `inactive` and the reconciliation would write `inactive`
 * snapshots for every mapped offer. But a task that is never registered writes NO
 * snapshot at all, so every Erli mapping resolved to the `Unsynced` lifecycle
 * bucket permanently and was invisible on the default `/listings` tab - a worse
 * failure than the one being guarded against. The guard's premise has also expired:
 * Erli's `ProductResponse.status` is declared `enum ["active","inactive"]` in the
 * sandbox swagger, and every mapped offer on the demo connection read back
 * `active`. A deployment that still wants the task off sets
 * `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED=false`.
 *
 * @module libs/integrations/erli/src/infrastructure/scheduler
 * @see {@link SchedulerTaskConfig} in `@openlinker/core/sync`.
 */
import type { SchedulerTaskConfig } from '@openlinker/core/sync';

/** Hourly (5-field cron: min hour day month dow — aligned with the Allegro tasks). */
const ERLI_OFFER_STATUS_SYNC_CRON = '0 * * * *';
/** Mapped offers refreshed per run (rolling scan-offset). */
const ERLI_OFFER_STATUS_SYNC_PAGE_LIMIT = 50;

/** Every 5 minutes (matches the Allegro orders-poll cadence). */
const ERLI_ORDERS_POLL_CRON = '*/5 * * * *';
/**
 * Advisory only (#1081 review): carried in the poll payload for observability, but
 * `ErliOrderSourceAdapter.listOrderFeed` does NOT honour it — the `GET /inbox` page
 * size is server-fixed (≤500 unread). Kept as documentation of intended page size;
 * wire it through only if Erli ever exposes a client-controlled limit.
 */
const ERLI_ORDERS_POLL_LIMIT = 200;

export function buildErliSchedulerTasks(): SchedulerTaskConfig[] {
  const tasks: SchedulerTaskConfig[] = [];

  // offer-status-sync — registered unconditionally, default ON (#2230): the
  // snapshot this reconciliation writes is the ONLY thing that lifts an Erli
  // mapping out of the `Unsynced` lifecycle bucket, so skipping registration hid
  // every Erli listing from the default `/listings` tab forever. Gated only by its
  // own env var at each tick, so `…_ENABLED=false` still turns it off (the #1063
  // escape hatch, now opt-OUT).
  tasks.push({
    taskId: 'erli-offer-status-sync',
    platformType: 'erli',
    jobType: 'marketplace.offer.statusSync',
    cronExpression: ERLI_OFFER_STATUS_SYNC_CRON,
    enabledEnvVar: 'OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED',
    generatePayload: () => ({
      schemaVersion: 1,
      limit: ERLI_OFFER_STATUS_SYNC_PAGE_LIMIT,
      cursorKey: 'erli.offerStatus.scanOffset',
    }),
    generateIdempotencyKey: (connection, timestamp) =>
      `marketplace:${connection.id}:offer:status:sync:${timestamp}`,
  });

  // orders-poll — MANDATORY order-ingestion backstop (#993): Erli webhooks
  // fire-once with no retry, so this poll heals missed/dropped webhooks. Always
  // registered; gated only by its own env var
  // (`OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED`) at each tick.
  tasks.push({
    taskId: 'erli-orders-poll',
    platformType: 'erli',
    requiredCapability: 'OrderSource',
    jobType: 'marketplace.orders.poll',
    cronExpression: ERLI_ORDERS_POLL_CRON,
    enabledEnvVar: 'OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED',
    generatePayload: () => ({
      schemaVersion: 1,
      limit: ERLI_ORDERS_POLL_LIMIT,
      cursorKey: 'erli.orders.inboxCursor',
    }),
    generateIdempotencyKey: (connection, timestamp) =>
      `marketplace:${connection.id}:orders:poll:${timestamp}`,
  });

  return tasks;
}
