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
 * `shopify-source-fulfillment-status-sync`: reads back a fulfilment made in the
 * Shopify admin for an order ingested from the store (default ON, hourly;
 * `OL_SHOPIFY_SOURCE_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED=false` stops it).
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
      // A Shopify copy fulfilled in the Shopify admin is read back into a
      // branch-1 Shipment. Only a Shopify that receives orders has copies.
      taskId: 'shopify-fulfillment-status-sync',
      platformType: SHOPIFY_PLATFORM_TYPE,
      requiredCapability: 'OrderProcessorManager',
      jobType: 'marketplace.fulfillment.statusSync',
      cronExpression: '*/15 * * * *',
      enabledEnvVar: 'OL_SHOPIFY_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED',
      generatePayload: (_connection: Connection) => ({
        schemaVersion: 1 as const,
        limit: 100,
        cursorKey: 'shopify.fulfillmentStatus.scanOffset',
        updatedSinceDays: 30,
      }),
      generateIdempotencyKey: (connection: Connection, timestamp: string): string =>
        `marketplace:${connection.id}:shopify:fulfillment:status:sync:${timestamp}`,
    },
    {
      // A shipment made in the Shopify admin on an order OL ingested FROM this
      // store is read back (`OrderFulfillmentReadback`, ADR-012 amendment). Gated
      // on OrderSource, never on the guard-only sub-capability; the core service
      // no-ops where the adapter lacks it. Its own cursor, so a store that is
      // also a destination never shares the destination task's offset.
      taskId: 'shopify-source-fulfillment-status-sync',
      platformType: SHOPIFY_PLATFORM_TYPE,
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.sourceFulfillment.statusSync',
      cronExpression: '20 * * * *',
      enabledEnvVar: 'OL_SHOPIFY_SOURCE_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED',
      generatePayload: (_connection: Connection) => ({
        schemaVersion: 1 as const,
        limit: 100,
        cursorKey: 'shopify.sourceFulfillmentStatus.scanOffset',
        updatedSinceDays: 30,
      }),
      generateIdempotencyKey: (connection: Connection, timestamp: string): string =>
        `marketplace:${connection.id}:shopify:source:fulfillment:status:sync:${timestamp}`,
    },
    {
      // Live status of published products (#4192): one page of the connection's
      // published/draft records per tick into shop_product_status_snapshots.
      // Gated on ProductPublisher; the sub-capability is narrowed in core.
      taskId: 'shopify-product-status-sync',
      platformType: SHOPIFY_PLATFORM_TYPE,
      requiredCapability: 'ProductPublisher',
      jobType: 'shop.product.statusSync',
      cronExpression: '0 * * * *',
      enabledEnvVar: 'OL_SHOPIFY_PRODUCT_STATUS_SYNC_SCHEDULER_ENABLED',
      generatePayload: (_connection: Connection) => ({
        schemaVersion: 1 as const,
        cursorKey: 'shop.productStatus.scanOffset',
        limit: 100,
      }),
      generateIdempotencyKey: (connection: Connection, timestamp: string): string =>
        `shop:${connection.id}:product:status:sync:${timestamp}`,
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
