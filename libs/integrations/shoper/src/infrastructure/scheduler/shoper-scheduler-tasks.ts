/**
 * Shoper Scheduler Tasks
 *
 * Four cron tasks:
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
 *   - `shoper-source-fulfillment-status-sync` - the same read-back for a shop OL
 *     ingests orders FROM: asks the shop, through `OrderFulfillmentReadback`,
 *     whether somebody shipped an order in the Shoper panel, records a parcel
 *     number OL does not already know, and relays it to the order's
 *     destinations (ADR-012 amendment). Rolling scan-offset cursor
 *     `shoper.sourceFulfillmentStatus.scanOffset`, distinct from the
 *     destination task's so a shop that is both never shares one offset.
 *
 * The orders-poll cadence is relaxed (10 min) because webhooks already carry the
 * primary load and the shop's request budget (about 10 req/s per SHOP, shared
 * with the merchant's other integrations - see `SHOPER_DEFAULT_RATE_LIMIT`) is
 * better spent on the work a delivery triggers.
 *
 * It also contributes the published-product status reconcile, for a connection
 * used as a publish destination.
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
    {
      // Default ON like every other Shoper task: a merchant packing in the
      // Shoper panel is the ordinary case for a Shoper source, not an edge, and
      // the per-order cost is bounded - an order OL already tracks is never
      // read, and a recorded parcel is never read again.
      taskId: 'shoper-source-fulfillment-status-sync',
      platformType: SHOPER_PLATFORM_TYPE,
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.sourceFulfillment.statusSync',
      cronExpression: '*/15 * * * *',
      enabledEnvVar: 'OL_SHOPER_SOURCE_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED',
      generatePayload: (_connection: Connection) => ({
        schemaVersion: 1 as const,
        limit: 100,
        cursorKey: 'shoper.sourceFulfillmentStatus.scanOffset',
        updatedSinceDays: 30,
      }),
      generateIdempotencyKey: (connection: Connection, timestamp: string): string =>
        `marketplace:${connection.id}:shoper:source:fulfillment:status:sync:${timestamp}`,
    },
    {
      // Steady-state shop product-status reconcile (#1845), the same task
      // WooCommerce registers: one page of the connection's published / draft
      // products per tick, so a product hidden or deleted in the shop panel is
      // detected. Hourly, one request per product, so it spends the same per-shop
      // request budget every other Shoper call shares. Gated on `ProductPublisher`; the core
      // service further no-ops when the adapter lacks `ShopProductStatusReader`.
      taskId: 'shoper-product-status-sync',
      platformType: SHOPER_PLATFORM_TYPE,
      requiredCapability: 'ProductPublisher',
      jobType: 'shop.product.statusSync',
      cronExpression: '0 * * * *',
      enabledEnvVar: 'OL_SHOPER_SHOP_STATUS_SYNC_SCHEDULER_ENABLED',
      generatePayload: (_connection: Connection) => ({
        schemaVersion: 1 as const,
        cursorKey: 'shop.productStatus.scanOffset',
        limit: 100,
      }),
      generateIdempotencyKey: (connection: Connection, timestamp: string): string =>
        `shop:${connection.id}:product:status:sync:${timestamp}`,
    },
  ];
}
