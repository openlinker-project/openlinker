/**
 * Mirakl Scheduler Tasks
 *
 * The scheduler tasks one Mirakl operator contributes. Mirakl gives sellers no
 * webhooks, so everything polls:
 *
 * - **orders poll** (every 5 min, #4275): `marketplace.orders.poll`; core calls
 *   `MiraklOrderSourceAdapter.listOrderFeed`, which also accepts waiting
 *   orders. The only way new orders arrive.
 * - **offer writes** (every 5 min, #4277): `marketplace.offerQuantity.reconcile`;
 *   settles finished STO01 / PRI01 imports and sends the recorded stock and
 *   price changes as one file each. Mirakl asks sellers not to import more
 *   often than every few minutes, which is why stock is not sent per change.
 * - **offers sync** (hourly, #4277): `marketplace.offers.sync` over OF21, which
 *   links offers created in the operator panel to OL variants by EAN and SKU.
 * - **offer status** (hourly, #4277): `marketplace.offer.statusSync`; `active`
 *   and `inactivity_reasons`, plus the price and quantity the channel shows.
 * - **returns poll** (every 15 min, #4279): `marketplace.returns.poll` over
 *   RT11 by last-updated window. Mirakl recommends RT11 at most every 5
 *   minutes; the returns the feed read answer the follow-up reads from the
 *   cache, so each return does not cost another RT11 call.
 * - **returns status** (hourly, #4279): `marketplace.returns.statusSync`
 *   re-reads open returns until a terminal state, the backstop for a change
 *   the window missed. One RT11 call per return, so the page is small.
 *
 * Registered unconditionally and gated at each tick by its own
 * `OL_{PLATFORM}_..._SCHEDULER_ENABLED`, which turns a task off only on the
 * literal `'false'`.
 *
 * Task ids, cursor keys and env vars carry the operator's platform type, so
 * two Mirakl operators never share one.
 *
 * @module libs/integrations/mirakl/src/infrastructure/scheduler
 * @see {@link SchedulerTaskConfig} in `@openlinker/core/sync`.
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { SchedulerTaskConfig } from '@openlinker/core/sync';
import type { MiraklOperatorProfile } from '../../domain/types/mirakl-operator-profile.types';

const ORDERS_POLL_CRON = '*/5 * * * *';
/** Orders read per poll window before the window is halved (two OR11 pages). */
const ORDERS_POLL_LIMIT = 200;
const OFFER_WRITES_CRON = '*/5 * * * *';
/** Imports settled per pass; each costs one status read. */
const OFFER_WRITES_IMPORT_LIMIT = 50;
/**
 * A stock-master connection (#4284) sends its queued stock every minute:
 * Mirakl takes one STO01 file per shop about every 30 seconds, and the stock
 * it masters is what every other channel sells against.
 */
const MASTER_STOCK_WRITES_CRON = '* * * * *';
const OFFERS_SYNC_CRON = '20 * * * *';
/** OF21 page size; the handler follows the cursor through the rest. */
const OFFERS_SYNC_LIMIT = 100;
const OFFER_STATUS_CRON = '40 * * * *';
/** Offers re-read per status pass (one OF21 read each). */
const OFFER_STATUS_LIMIT = 100;
const RETURNS_POLL_CRON = '*/15 * * * *';
const RETURNS_POLL_LIMIT = 100;
const RETURNS_STATUS_CRON = '50 * * * *';
/**
 * Open returns re-read per hourly pass, one RT11 call each. The feed already
 * carries transitions, so this backstop stays small rather than sending a
 * burst of RT11 calls against a 5-minute recommendation.
 */
const RETURNS_STATUS_LIMIT = 10;
/** Returns older than this are no longer re-read by the status sync. */
const RETURNS_STATUS_LOOKBACK_DAYS = 90;

function envPrefix(profile: MiraklOperatorProfile): string {
  return `OL_${profile.platformType.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}

function masterCatalogConnectionId(connection: Connection): string | null {
  const value = (connection.config as Record<string, unknown> | null)?.masterCatalogConnectionId;
  return typeof value === 'string' && value !== '' ? value : null;
}

export function miraklOrdersCursorKey(profile: MiraklOperatorProfile): string {
  return `${profile.platformType}.orders.lastUpdateDate`;
}

export function buildMiraklSchedulerTasks(profile: MiraklOperatorProfile): SchedulerTaskConfig[] {
  const platform = profile.platformType;
  const env = envPrefix(profile);
  return [
    {
      taskId: `${platform}-orders-poll`,
      platformType: platform,
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.orders.poll',
      cronExpression: ORDERS_POLL_CRON,
      enabledEnvVar: `${env}_ORDERS_POLL_SCHEDULER_ENABLED`,
      generatePayload: () => ({
        schemaVersion: 1,
        limit: ORDERS_POLL_LIMIT,
        cursorKey: miraklOrdersCursorKey(profile),
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:orders:poll:${timestamp}`,
    },
    {
      taskId: `${platform}-offer-writes`,
      platformType: platform,
      requiredCapability: 'OfferManager',
      jobType: 'marketplace.offerQuantity.reconcile',
      cronExpression: OFFER_WRITES_CRON,
      enabledEnvVar: `${env}_OFFER_WRITES_SCHEDULER_ENABLED`,
      generatePayload: () => ({ schemaVersion: 1, limit: OFFER_WRITES_IMPORT_LIMIT }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:offerQuantity:reconcile:${timestamp}`,
    },
    {
      // Same pass, for a connection that masters stock instead of receiving it
      // (#4284): it holds no OfferManager, so the task above never runs for it.
      taskId: `${platform}-master-stock-writes`,
      platformType: platform,
      requiredCapability: 'InventoryMaster',
      jobType: 'marketplace.offerQuantity.reconcile',
      cronExpression: MASTER_STOCK_WRITES_CRON,
      enabledEnvVar: `${env}_MASTER_STOCK_WRITES_SCHEDULER_ENABLED`,
      generatePayload: () => ({ schemaVersion: 1, limit: OFFER_WRITES_IMPORT_LIMIT }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:masterStock:reconcile:${timestamp}`,
    },
    {
      taskId: `${platform}-offers-sync`,
      platformType: platform,
      requiredCapability: 'OfferManager',
      jobType: 'marketplace.offers.sync',
      cronExpression: OFFERS_SYNC_CRON,
      enabledEnvVar: `${env}_OFFERS_SYNC_SCHEDULER_ENABLED`,
      generatePayload: (connection) => ({
        schemaVersion: 1,
        limit: OFFERS_SYNC_LIMIT,
        cursor: null,
        feedType: 'offers',
        masterConnectionId: masterCatalogConnectionId(connection),
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:offers:sync:${timestamp}`,
    },
    {
      taskId: `${platform}-offer-status-sync`,
      platformType: platform,
      requiredCapability: 'OfferManager',
      jobType: 'marketplace.offer.statusSync',
      cronExpression: OFFER_STATUS_CRON,
      enabledEnvVar: `${env}_OFFER_STATUS_SYNC_SCHEDULER_ENABLED`,
      generatePayload: () => ({
        schemaVersion: 1,
        limit: OFFER_STATUS_LIMIT,
        cursorKey: `${platform}.offerStatus.scanOffset`,
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:offer:status:sync:${timestamp}`,
    },
    {
      taskId: `${platform}-returns-poll`,
      platformType: platform,
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.returns.poll',
      cronExpression: RETURNS_POLL_CRON,
      enabledEnvVar: `${env}_RETURNS_POLL_SCHEDULER_ENABLED`,
      generatePayload: () => ({
        schemaVersion: 1,
        cursorKey: `${platform}.returns.lastUpdateDate`,
        limit: RETURNS_POLL_LIMIT,
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:returns:poll:${timestamp}`,
    },
    {
      taskId: `${platform}-returns-status-sync`,
      platformType: platform,
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.returns.statusSync',
      cronExpression: RETURNS_STATUS_CRON,
      enabledEnvVar: `${env}_RETURNS_STATUS_SYNC_SCHEDULER_ENABLED`,
      generatePayload: () => ({
        schemaVersion: 1,
        limit: RETURNS_STATUS_LIMIT,
        cursorKey: `${platform}.returns.scanOffset`,
        lookbackDays: RETURNS_STATUS_LOOKBACK_DAYS,
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:returns:status:sync:${timestamp}`,
    },
  ];
}
