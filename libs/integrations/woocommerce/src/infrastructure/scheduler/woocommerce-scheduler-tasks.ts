/**
 * WooCommerce Scheduler Tasks
 *
 * Contributes the orders-poll cron task to SchedulerTaskRegistryService.
 * No ConfigService dependency — cron is fixed at 5 min; env gate evaluated
 * by SchedulerService at tick time, not here.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/scheduler
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { SchedulerTaskConfig } from '@openlinker/core/sync';

export function buildWooCommerceSchedulerTasks(): SchedulerTaskConfig[] {
  return [
    {
      taskId: 'woocommerce-orders-poll',
      platformType: 'woocommerce',
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.orders.poll',
      cronExpression: '*/5 * * * *',
      enabledEnvVar: 'OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED',
      // Return type omitted — let TypeScript infer the object literal shape, which
      // is structurally assignable to Record<string, unknown> without an index signature.
      // The runtime shape matches MarketplaceOrdersPollPayloadV1 exactly.
      generatePayload: (_connection: Connection) => ({
        schemaVersion: 1 as const,
        cursorKey: 'woocommerce.orders.lastModifiedAfter',
        limit: 100,
      }),
      generateIdempotencyKey: (connection: Connection, timestamp: string): string =>
        `marketplace:${connection.id}:wc:orders:poll:${timestamp}`,
    },
    {
      // Steady-state shop product-status reconcile (#1845): drains one page of a
      // connection's published/draft products per tick and upserts the live
      // shop-side status snapshot, so an unpublished/trashed product is
      // detected. Gated on the `ProductPublisher` capability; the core sync
      // service further no-ops when the adapter lacks `ShopProductStatusReader`.
      taskId: 'woocommerce-product-status-sync',
      platformType: 'woocommerce',
      requiredCapability: 'ProductPublisher',
      jobType: 'shop.product.statusSync',
      cronExpression: '0 * * * *',
      enabledEnvVar: 'OL_WOOCOMMERCE_PRODUCT_STATUS_SYNC_SCHEDULER_ENABLED',
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
