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
import type { SchedulerTaskConfig } from '@openlinker/core/sync';

import { AMAZON_PLATFORM_TYPE } from '../../amazon.constants';

const AMAZON_ORDERS_POLL_CRON = '*/5 * * * *';

/** `searchOrders` returns at most 100 orders a page. */
export const AMAZON_ORDERS_POLL_LIMIT = 100;

export const AMAZON_ORDERS_CURSOR_KEY = 'amazon.orders.feedCursor';

/** SQS returns at most 10 messages per receive. */
export const AMAZON_NOTIFICATIONS_DRAIN_MAX_MESSAGES = 10;

export function buildAmazonSchedulerTasks(): SchedulerTaskConfig[] {
  return [
    // #4179: drains the operator's SQS queue every minute, so an order arrives
    // within about a minute instead of on the next orders poll. OFF by default
    // (`OL_AMAZON_NOTIFICATIONS_DRAIN_SCHEDULER_ENABLED`): it needs a queue and
    // its AWS key on the connection. The orders poll stays as the backstop.
    {
      taskId: 'amazon-notifications-drain',
      platformType: AMAZON_PLATFORM_TYPE,
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.notifications.drain',
      cronExpression: '* * * * *',
      enabledEnvVar: 'OL_AMAZON_NOTIFICATIONS_DRAIN_SCHEDULER_ENABLED',
      enabledDefault: false,
      generatePayload: () => ({ schemaVersion: 1, maxMessages: AMAZON_NOTIFICATIONS_DRAIN_MAX_MESSAGES }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:notifications:drain:${timestamp}`,
    },
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
