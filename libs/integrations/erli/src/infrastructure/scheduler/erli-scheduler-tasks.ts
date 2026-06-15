/**
 * Erli Scheduler Tasks
 *
 * Builds the `SchedulerTaskConfig` instances Erli contributes to the core
 * `SchedulerTaskRegistryService`. One task today:
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
 * Unlike the Allegro tasks (which read cron/page-size overrides off a NestJS
 * `ConfigService`), Erli is wired via `createNestAdapterModule` and has no
 * plugin-scoped `ConfigService`, so this builder takes no config: the task is
 * registered unconditionally with sensible defaults and the
 * `OL_ERLI_OFFER_STATUS_SYNC_SCHEDULER_ENABLED` env gate is re-checked by the
 * scheduler at each cron tick (set it to `"false"` to disable without a config
 * dependency at registration time).
 *
 * @module libs/integrations/erli/src/infrastructure/scheduler
 * @see {@link SchedulerTaskConfig} in `@openlinker/core/sync`.
 */
import type { SchedulerTaskConfig } from '@openlinker/core/sync';

/** Hourly (6-field cron: sec min hour day month dow). */
const ERLI_OFFER_STATUS_SYNC_CRON = '0 0 * * * *';
/** Mapped offers refreshed per run (rolling scan-offset). */
const ERLI_OFFER_STATUS_SYNC_PAGE_LIMIT = 50;

export function buildErliSchedulerTasks(): SchedulerTaskConfig[] {
  return [
    {
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
    },
  ];
}
