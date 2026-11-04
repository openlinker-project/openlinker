/**
 * Shopify Scheduler Tasks
 *
 * The orders poll: the only ingestion path in this prototype, since inbound
 * webhooks are out of scope. Registered for every Shopify connection with
 * `OrderSource` enabled; `OL_SHOPIFY_POLL_SCHEDULER_ENABLED=false` switches it
 * off.
 *
 * @module libs/integrations/shopify/src/infrastructure/scheduler
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { SchedulerTaskConfig } from '@openlinker/core/sync';

import { SHOPIFY_PLATFORM_TYPE } from '../../shopify.constants';

export function buildShopifySchedulerTasks(): SchedulerTaskConfig[] {
  return [
    {
      taskId: 'shopify-orders-poll',
      platformType: SHOPIFY_PLATFORM_TYPE,
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.orders.poll',
      cronExpression: '*/5 * * * *',
      enabledEnvVar: 'OL_SHOPIFY_POLL_SCHEDULER_ENABLED',
      generatePayload: (_connection: Connection) => ({
        schemaVersion: 1 as const,
        cursorKey: 'shopify.orders.cursor',
        limit: 100,
      }),
      generateIdempotencyKey: (connection: Connection, timestamp: string): string =>
        `marketplace:${connection.id}:shopify:orders:poll:${timestamp}`,
    },
  ];
}
