/**
 * Shoper Scheduler Tasks
 *
 * Contributes the orders-poll cron task (#3644). Webhooks are the low-latency
 * path, but a delivery can be lost (tunnel down, API restarting, shop retry
 * budget exhausted); the poll is the reconciliation backstop, as it is for
 * PrestaShop and WooCommerce (#904). It reads the order feed's `order_id`
 * keyset cursor, so it finds NEW orders; an edit to an order whose id was
 * already read is only observed through its webhook.
 *
 * The cadence is relaxed (10 min) because Shoper's request ceiling is unknown
 * (SPIKE-3638 C6) and webhooks already carry the primary load.
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
  ];
}
