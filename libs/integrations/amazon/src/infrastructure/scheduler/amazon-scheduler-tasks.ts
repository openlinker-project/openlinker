/**
 * Amazon Scheduler Tasks
 *
 * `amazon-orders-poll` reads the order feed (`marketplace.orders.poll`). OFF by
 * default (`OL_AMAZON_ORDERS_POLL_SCHEDULER_ENABLED`): ingesting a seller's
 * Amazon orders creates them in every destination, so an operator turns it on.
 * Buyer data is removed 30 days after the ship-by deadline by the order
 * buyer-data retention pass (`buyerDataRetentionDays` on the manifest). `searchOrders` allows
 * 0.0056 req/s with a burst of 20, so one tick every five minutes reading up to
 * a few pages stays inside the quota.
 *
 * @module libs/integrations/amazon/src/infrastructure/scheduler
 */
import type { Connection, ConnectionFilters } from '@openlinker/core/identifier-mapping';
import type { SchedulerTaskConfig } from '@openlinker/core/sync';

import { AMAZON_PLATFORM_TYPE } from '../../amazon.constants';
import { readNotificationQueue, readSellerId } from '../../domain/policies/amazon-config.policy';

const AMAZON_ORDERS_POLL_CRON = '*/5 * * * *';

/** `searchOrders` returns at most 100 orders a page. */
export const AMAZON_ORDERS_POLL_LIMIT = 100;

export const AMAZON_ORDERS_CURSOR_KEY = 'amazon.orders.feedCursor';

/** SQS returns at most 10 messages per receive. */
export const AMAZON_NOTIFICATIONS_DRAIN_MAX_MESSAGES = 10;

/** The connection's master catalogue, which the offer mapping sync links listings against. */
function readMasterCatalogConnectionId(connection: Connection): string | null {
  const value = (connection.config ?? {}).masterCatalogConnectionId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** `searchListingsItems` and the status reads page by 20. */
const AMAZON_OFFERS_PAGE_LIMIT = 20;

export function buildAmazonSchedulerTasks(): SchedulerTaskConfig[] {
  return [
    {
      taskId: 'amazon-orders-poll',
      platformType: AMAZON_PLATFORM_TYPE,
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.orders.poll',
      cronExpression: AMAZON_ORDERS_POLL_CRON,
      enabledEnvVar: 'OL_AMAZON_ORDERS_POLL_SCHEDULER_ENABLED',
      enabledDefault: false,
      generatePayload: () => ({
        schemaVersion: 1,
        limit: AMAZON_ORDERS_POLL_LIMIT,
        cursorKey: AMAZON_ORDERS_CURSOR_KEY,
      }),
      generateIdempotencyKey: (connection, timestamp) => `marketplace:${connection.id}:orders:poll:${timestamp}`,
    },
  ];
}

/**
 * `amazon-notifications-drain` (#4179) reads the operator's SQS queue every
 * minute (`marketplace.notifications.drain`), so an order arrives within about
 * a minute instead of on the next orders poll. OFF by default
 * (`OL_AMAZON_NOTIFICATIONS_DRAIN_SCHEDULER_ENABLED`).
 *
 * Only active Amazon connections with `OrderSource` enabled AND a valid
 * `notificationQueueUrl` are drained, so a connection without a queue gets no
 * job at all rather than a failed one every minute. A queue whose AWS key is
 * missing still gets a job; the factory then builds no queue reader and the
 * job ends as a business failure naming the cause. The orders poll stays the
 * delivery guarantee: a notification is only a trigger.
 *
 * Registered by `AmazonHostModule`, which holds the connection list
 * the filter needs (`HostServices` carries no `ConnectionPort`).
 */
export function buildAmazonNotificationsDrainTask(
  listConnections: (filters: ConnectionFilters) => Promise<Connection[]>,
): SchedulerTaskConfig {
  return {
    taskId: 'amazon-notifications-drain',
    connectionFilter: async (): Promise<Connection[]> => {
      const connections = await listConnections({ platformType: AMAZON_PLATFORM_TYPE, status: 'active' });
      return connections.filter(
        (connection) =>
          connection.enabledCapabilities.includes('OrderSource') &&
          readNotificationQueue(connection.config.notificationQueueUrl) !== undefined,
      );
    },
    jobType: 'marketplace.notifications.drain',
    cronExpression: '* * * * *',
    enabledEnvVar: 'OL_AMAZON_NOTIFICATIONS_DRAIN_SCHEDULER_ENABLED',
    enabledDefault: false,
    generatePayload: () => ({ schemaVersion: 1, maxMessages: AMAZON_NOTIFICATIONS_DRAIN_MAX_MESSAGES }),
    generateIdempotencyKey: (connection, timestamp) => `marketplace:${connection.id}:notifications:drain:${timestamp}`,
  };
}

/**
 * The two #4180 listing tasks, both OFF by default:
 *   - `amazon-offers-sync` (`OL_AMAZON_OFFERS_SYNC_SCHEDULER_ENABLED`) links the
 *     seller's Amazon listings to variants by SKU;
 *   - `amazon-offer-status-sync` (`OL_AMAZON_OFFER_STATUS_SYNC_SCHEDULER_ENABLED`)
 *     refreshes each linked listing's live status, price and quantity, and
 *     Amazon's issues on it.
 *
 * Only active Amazon connections with `OfferManager` enabled AND a valid
 * merchant token (`sellerId`) are scheduled: every Listings Items call names
 * the seller, so a connection without one would fail every run. Registered by
 * `AmazonHostModule`, which holds the connection list.
 */
export function buildAmazonOfferTasks(
  listConnections: (filters: ConnectionFilters) => Promise<Connection[]>,
): SchedulerTaskConfig[] {
  const connectionFilter = async (): Promise<Connection[]> => {
    const connections = await listConnections({ platformType: AMAZON_PLATFORM_TYPE, status: 'active' });
    return connections.filter(
      (connection) =>
        connection.enabledCapabilities.includes('OfferManager') &&
        readSellerId(connection.config.sellerId) !== undefined,
    );
  };
  return [
    {
      taskId: 'amazon-offers-sync',
      connectionFilter,
      jobType: 'marketplace.offers.sync',
      cronExpression: '15 * * * *',
      enabledEnvVar: 'OL_AMAZON_OFFERS_SYNC_SCHEDULER_ENABLED',
      enabledDefault: false,
      generatePayload: (connection): Record<string, unknown> => ({
        schemaVersion: 1,
        limit: AMAZON_OFFERS_PAGE_LIMIT,
        cursor: null,
        feedType: 'offers',
        masterConnectionId: readMasterCatalogConnectionId(connection),
      }),
      generateIdempotencyKey: (connection, timestamp) => `marketplace:${connection.id}:offers:sync:${timestamp}`,
    },
    {
      taskId: 'amazon-offer-status-sync',
      connectionFilter,
      jobType: 'marketplace.offer.statusSync',
      cronExpression: '45 * * * *',
      enabledEnvVar: 'OL_AMAZON_OFFER_STATUS_SYNC_SCHEDULER_ENABLED',
      enabledDefault: false,
      generatePayload: (): Record<string, unknown> => ({
        schemaVersion: 1,
        limit: AMAZON_OFFERS_PAGE_LIMIT,
        cursorKey: 'amazon.offerStatus.scanOffset',
      }),
      generateIdempotencyKey: (connection, timestamp) => `marketplace:${connection.id}:offer:status:sync:${timestamp}`,
    },
  ];
}
