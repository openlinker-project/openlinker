/**
 * PrestaShop Scheduler Tasks
 *
 * Builds the `SchedulerTaskConfig` instances PrestaShop contributes to the
 * core `SchedulerTaskRegistryService` (#584). Two tasks today:
 *
 *   - `prestashop-orders-poll` (#904) — the order-ingestion **reconciliation
 *     backstop**. Webhooks (epic #900, Phases 1–2) are the low-latency primary
 *     path; this relaxed poll (default every 10 min) heals missed/dropped
 *     webhooks by re-reading orders changed since the `date_upd` watermark
 *     (cursor key `prestashop.orders.dateUpd`) and enqueuing
 *     `marketplace.orders.poll`. Both paths converge on the idempotent
 *     `OrderIngestionService.syncOrderFromSource` (#906 lock + #909
 *     update-or-create), so a webhook-ingested order is not re-created by a
 *     later poll — the poll *reconciles* changed orders (re-pull is
 *     authoritative; last write wins), it does not merely fill gaps.
 *   - `prestashop-fulfillment-status-sync` (#834) — branch-1 (OMP-fulfilled)
 *     shipment status read-back. Reads each mirrored order's PrestaShop
 *     state via `FulfillmentStatusReader.getFulfillmentStatus` and projects
 *     branch-1 `Shipment` rows. Default every 15 minutes. Rolling
 *     scan-offset cursor key `prestashop.fulfillmentStatus.scanOffset`.
 *
 * Env-var gating mirrors the Allegro scheduler-tasks shape. The scheduler
 * also re-checks the gate at each cron tick, so toggling without restart
 * works for tasks that *did* register at boot.
 *
 * Env vars (orders-poll): `OL_PRESTASHOP_POLL_SCHEDULER_ENABLED` (gate,
 * default on), `OL_PRESTASHOP_POLL_INTERVAL_CRON` (cadence, default
 * `0 *\/10 * * * *`), `OL_PRESTASHOP_POLL_PAGE_LIMIT` (feed page size,
 * default 100).
 *
 * @module libs/integrations/prestashop/src/infrastructure/scheduler
 * @see {@link SchedulerTaskConfig} in `@openlinker/core/sync`.
 */
import type { ConfigService } from '@nestjs/config';
import type { SchedulerTaskConfig } from '@openlinker/core/sync';

const isEnabled = (configService: ConfigService, key: string): boolean =>
  configService.get<string>(key, 'true') !== 'false';

/**
 * Build the PrestaShop scheduler-task list. Returns 0–1 tasks depending on
 * the `OL_PRESTASHOP_*_SCHEDULER_ENABLED` env-var gates.
 */
export function buildPrestashopSchedulerTasks(
  configService: ConfigService,
): SchedulerTaskConfig[] {
  const tasks: SchedulerTaskConfig[] = [];

  // Order-ingestion reconciliation backstop (#904). Relaxed cadence — webhooks
  // are the primary path; this heals missed/dropped webhooks. Fanned out to
  // every active `prestashop` connection (platformType-scoped, mirroring
  // `allegro-orders-poll`); a destination-only connection with OrderSource
  // disabled is the operator's opt-out (PS defaults enable it).
  if (isEnabled(configService, 'OL_PRESTASHOP_POLL_SCHEDULER_ENABLED')) {
    // 6-field cron (seconds-leading), matching the sibling fulfillment task;
    // the `cron` package accepts both 5- and 6-field forms.
    const cronExpression = configService.get<string>(
      'OL_PRESTASHOP_POLL_INTERVAL_CRON',
      '0 */10 * * * *',
    );
    const pollLimitRaw = Number(
      configService.get<string>('OL_PRESTASHOP_POLL_PAGE_LIMIT', '100'),
    );
    const pollLimit = Number.isFinite(pollLimitRaw) && pollLimitRaw > 0 ? pollLimitRaw : 100;

    tasks.push({
      taskId: 'prestashop-orders-poll',
      platformType: 'prestashop',
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.orders.poll',
      cronExpression,
      enabledEnvVar: 'OL_PRESTASHOP_POLL_SCHEDULER_ENABLED',
      generatePayload: () => ({
        schemaVersion: 1,
        cursorKey: 'prestashop.orders.dateUpd',
        limit: pollLimit,
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:orders:poll:${timestamp}`,
    });
  }

  if (
    isEnabled(configService, 'OL_PRESTASHOP_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED')
  ) {
    const cronExpression = configService.get<string>(
      'OL_PRESTASHOP_FULFILLMENT_STATUS_SYNC_INTERVAL_CRON',
      '0 */15 * * * *',
    );
    const pageLimitRaw = Number(
      configService.get<string>('OL_PRESTASHOP_FULFILLMENT_STATUS_SYNC_PAGE_LIMIT', '100'),
    );
    const pageLimit = Number.isFinite(pageLimitRaw) && pageLimitRaw > 0 ? pageLimitRaw : 100;
    const updatedSinceDaysRaw = Number(
      configService.get<string>(
        'OL_PRESTASHOP_FULFILLMENT_STATUS_SYNC_UPDATED_SINCE_DAYS',
        '30',
      ),
    );
    const updatedSinceDays =
      Number.isFinite(updatedSinceDaysRaw) && updatedSinceDaysRaw > 0 ? updatedSinceDaysRaw : 30;

    tasks.push({
      taskId: 'prestashop-fulfillment-status-sync',
      platformType: 'prestashop',
      jobType: 'marketplace.fulfillment.statusSync',
      cronExpression,
      enabledEnvVar: 'OL_PRESTASHOP_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED',
      generatePayload: () => ({
        schemaVersion: 1,
        limit: pageLimit,
        cursorKey: 'prestashop.fulfillmentStatus.scanOffset',
        updatedSinceDays,
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:fulfillment:status:sync:${timestamp}`,
    });
  }

  return tasks;
}
