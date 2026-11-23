/**
 * Mirakl Scheduler Tasks
 *
 * The scheduler tasks one Mirakl operator contributes. Today one: the orders
 * poll, which enqueues the core `marketplace.orders.poll` job; core then calls
 * `MiraklOrderSourceAdapter.listOrderFeed`, which also accepts waiting orders.
 * Mirakl gives sellers no webhooks, so this poll is the only way new orders
 * arrive.
 *
 * Every 5 minutes, like the Allegro and Erli polls. Registered unconditionally
 * and gated at each tick by `OL_{PLATFORM}_ORDERS_POLL_SCHEDULER_ENABLED`,
 * which turns the task off only on the literal `'false'`.
 *
 * Task id, cursor key and env var carry the operator's platform type, so two
 * Mirakl operators never share a cursor.
 *
 * @module libs/integrations/mirakl/src/infrastructure/scheduler
 * @see {@link SchedulerTaskConfig} in `@openlinker/core/sync`.
 */
import type { SchedulerTaskConfig } from '@openlinker/core/sync';
import type { MiraklOperatorProfile } from '../../domain/types/mirakl-operator-profile.types';

const ORDERS_POLL_CRON = '*/5 * * * *';
/** Orders read per poll window before the window is halved (two OR11 pages). */
const ORDERS_POLL_LIMIT = 200;

export function miraklOrdersCursorKey(profile: MiraklOperatorProfile): string {
  return `${profile.platformType}.orders.lastUpdateDate`;
}

export function buildMiraklSchedulerTasks(profile: MiraklOperatorProfile): SchedulerTaskConfig[] {
  const platform = profile.platformType;
  return [
    {
      taskId: `${platform}-orders-poll`,
      platformType: platform,
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.orders.poll',
      cronExpression: ORDERS_POLL_CRON,
      enabledEnvVar: `OL_${platform.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_ORDERS_POLL_SCHEDULER_ENABLED`,
      generatePayload: () => ({
        schemaVersion: 1,
        limit: ORDERS_POLL_LIMIT,
        cursorKey: miraklOrdersCursorKey(profile),
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:orders:poll:${timestamp}`,
    },
  ];
}
