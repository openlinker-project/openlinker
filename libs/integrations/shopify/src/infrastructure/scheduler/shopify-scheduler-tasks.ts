/**
 * Shopify Scheduler Tasks
 *
 * The orders poll (#3977): until inbound webhooks arrive (#3981) the only
 * ingestion path, and afterwards the reconciliation backstop. Registered for
 * every Shopify connection with `OrderSource` enabled;
 * `OL_SHOPIFY_POLL_SCHEDULER_ENABLED=false` switches it off. It always passes
 * its own `cursorKey` (`shopify.orders.cursor`), so a run never writes under
 * the core default key (C22).
 *
 * The two returns passes (#2330 shape): discovery over the return feed and
 * the re-read of OpenLinker's open returns. Both require `OrderSource`, never
 * `ReturnSourceReader` (advertised-without-dispatch; naming it would fail
 * inside `dispatchCapability`), and both are OFF until
 * `OL_SHOPIFY_RETURNS_POLL_SCHEDULER_ENABLED` /
 * `OL_SHOPIFY_RETURNS_STATUS_SYNC_SCHEDULER_ENABLED` are `true`.
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
    {
      taskId: 'shopify-returns-poll',
      platformType: SHOPIFY_PLATFORM_TYPE,
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.returns.poll',
      cronExpression: '*/15 * * * *',
      enabledEnvVar: 'OL_SHOPIFY_RETURNS_POLL_SCHEDULER_ENABLED',
      enabledDefault: false,
      generatePayload: (_connection: Connection) => ({
        schemaVersion: 1 as const,
        cursorKey: 'shopify.returns.cursor',
        limit: 100,
      }),
      generateIdempotencyKey: (connection: Connection, timestamp: string): string =>
        `marketplace:${connection.id}:shopify:returns:poll:${timestamp}`,
    },
    {
      taskId: 'shopify-returns-status-sync',
      platformType: SHOPIFY_PLATFORM_TYPE,
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.returns.statusSync',
      cronExpression: '0 * * * *',
      enabledEnvVar: 'OL_SHOPIFY_RETURNS_STATUS_SYNC_SCHEDULER_ENABLED',
      enabledDefault: false,
      generatePayload: (_connection: Connection) => ({
        schemaVersion: 1 as const,
        limit: 50,
        cursorKey: 'shopify.returns.scanOffset',
        lookbackDays: 90,
      }),
      generateIdempotencyKey: (connection: Connection, timestamp: string): string =>
        `marketplace:${connection.id}:shopify:returns:status:sync:${timestamp}`,
    },
  ];
}
