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
 * **Opt-in, default OFF until #992 (review #1063).** The Erli `status` wire field
 * is still unconfirmed; if the real GET response doesn't carry it with the
 * expected values, `mapErliStatusToReadResult` falls to `inactive` and the
 * reconciliation would write `inactive` snapshots for every mapped offer —
 * surfacing live offers as inactive in the Listings UI. So this builder returns
 * the task ONLY when `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED === 'true'`
 * (inverting Allegro's default-on). Once enabled, the scheduler's per-tick env
 * gate still toggles it at runtime. Flip the default back to opt-out when #992
 * confirms the field.
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
/** Inbox messages read per poll (≤500 Erli unread cap). */
const ERLI_ORDERS_POLL_LIMIT = 200;

export function buildErliSchedulerTasks(): SchedulerTaskConfig[] {
  const tasks: SchedulerTaskConfig[] = [];

  // offer-status-sync — OPT-IN, default OFF (review #1063): don't reconcile
  // against the still-#992-provisional Erli `status` field until it's confirmed
  // (a wrong/absent field would write `inactive` for every mapped offer). The
  // scheduler's per-tick gate still toggles it at runtime once enabled. This
  // gates ONLY this task — any other Erli task (e.g. the orders-poll backstop) is
  // pushed unconditionally below.
  if (process.env.OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED === 'true') {
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
  }

  // orders-poll — MANDATORY order-ingestion backstop (#993): Erli webhooks
  // fire-once with no retry, so this poll heals missed/dropped webhooks. Always
  // registered; gated only by its own env var
  // (`OL_ERLI_ORDERS_POLL_SCHEDULER_ENABLED`) at each tick — NOT by the
  // offer-status opt-in above.
  tasks.push({
    taskId: 'erli-orders-poll',
    platformType: 'erli',
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
