/**
 * PrestaShop Scheduler Tasks
 *
 * Builds the `SchedulerTaskConfig` instances PrestaShop contributes to the
 * core `SchedulerTaskRegistryService` (#584). One task today:
 *
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
