/**
 * Shoper Scheduler Tasks
 *
 * Two cron tasks:
 *
 *   - `shoper-orders-poll` (#3644) - the order-ingestion reconciliation
 *     backstop. Webhooks are the low-latency path, but a delivery can be lost
 *     (tunnel down, API restarting, shop retry budget exhausted); the poll heals
 *     that, as it does for PrestaShop and WooCommerce (#904). Its cursor carries
 *     two passes: the `order_id` keyset that finds NEW orders and a `status_date`
 *     watermark that re-observes STATUS changes of orders already read (see
 *     `ShoperOrderSourceAdapter`). The cursor key keeps its original name so an
 *     upgraded connection keeps its place in the feed.
 *   - `shoper-fulfillment-status-sync` - branch-1 shipment read-back (#834) for a
 *     shop that RECEIVES orders: reads each mirrored order's parcels and status
 *     through `FulfillmentStatusReader` and projects branch-1 `Shipment` rows.
 *     Rolling scan-offset cursor `shoper.fulfillmentStatus.scanOffset`; cadence
 *     and defaults follow the PrestaShop task.
 *
 * The orders-poll cadence is relaxed (10 min) because Shoper's request ceiling
 * is unknown (SPIKE-3638 C6) and webhooks already carry the primary load.
 *
 * @module libs/integrations/shoper/src/infrastructure/scheduler
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { SchedulerTaskConfig } from '@openlinker/core/sync';

import { SHOPER_PLATFORM_TYPE } from '../../shoper.constants';

export function buildShoperSchedulerTasks(): SchedulerTaskConfig[] {
  return [
    {
      taskId: 'shoper-orders-poll',
      platformType: SHOPER_PLATFORM_TYPE,
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.orders.poll',
      cronExpression: '*/10 * * * *',
      enabledEnvVar: 'OL_SHOPER_POLL_SCHEDULER_ENABLED',
      generatePayload: (_connection: Connection) => ({
        schemaVersion: 1 as const,
        cursorKey: 'shoper.orders.lastOrderId',
        limit: 100,
      }),
      generateIdempotencyKey: (connection: Connection, timestamp: string): string =>
        `marketplace:${connection.id}:shoper:orders:poll:${timestamp}`,
    },
    {
      taskId: 'shoper-fulfillment-status-sync',
      platformType: SHOPER_PLATFORM_TYPE,
      // Only a shop that receives orders has mirrored orders to read back.
      requiredCapability: 'OrderProcessorManager',
      jobType: 'marketplace.fulfillment.statusSync',
      cronExpression: '*/15 * * * *',
      enabledEnvVar: 'OL_SHOPER_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED',
      generatePayload: (_connection: Connection) => ({
        schemaVersion: 1 as const,
        limit: 100,
        cursorKey: 'shoper.fulfillmentStatus.scanOffset',
        updatedSinceDays: 30,
      }),
      generateIdempotencyKey: (connection: Connection, timestamp: string): string =>
        `marketplace:${connection.id}:shoper:fulfillment:status:sync:${timestamp}`,
    },
  ];
}
