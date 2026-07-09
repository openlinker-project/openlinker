/**
 * Allegro Scheduler Tasks
 *
 * Builds the `SchedulerTaskConfig` instances Allegro contributes to the core
 * `SchedulerTaskRegistryService` (#584). Four tasks today:
 *
 *   - `allegro-orders-poll` — incremental `/order/events` ingest, default
 *     every 5 minutes. Cursor key `allegro.orders.lastEventId`.
 *   - `allegro-offers-sync` — incremental offer-events ingest (or full
 *     listing, depending on `OL_ALLEGRO_OFFERS_SYNC_FEED_TYPE`), default
 *     every 30 minutes. Cursor key `allegro.offers.lastEventId`.
 *   - `allegro-offer-status-sync` (#816) — steady-state refresh of mapped
 *     offers' publication status into `offer_status_snapshots`, default
 *     hourly. Rolling scan-offset cursor key `allegro.offerStatus.scanOffset`.
 *   - `allegro-shipment-status-sync` (#838) — steady-state refresh of
 *     non-terminal `shipments` for Allegro Delivery shipments: re-reads each
 *     shipment's `/shipment-management/shipments/{id}`, advances OL's
 *     `Shipment` row toward carrier reality (terminal states + asynchronous
 *     carrier-waybill backfill), and projects the backfilled tracking number
 *     to the destination OMP (PrestaShop via capability B). Default every
 *     15 minutes. Rolling scan-offset cursor key
 *     `allegro.shipmentStatus.scanOffset`.
 *
 * Env-var gating is preserved verbatim from the previous core implementation
 * for deployer back-compat: when `OL_ALLEGRO_POLL_SCHEDULER_ENABLED=false`
 * (or `OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED=false`,
 * `OL_ALLEGRO_OFFER_STATUS_SYNC_SCHEDULER_ENABLED=false`) the helper omits
 * the corresponding task. The scheduler also re-checks the gate at each
 * cron tick, so toggling without restart works for tasks that *did*
 * register at boot.
 *
 * @module libs/integrations/allegro/src/infrastructure/scheduler
 * @see {@link SchedulerTaskConfig} in `@openlinker/core/sync`.
 */
import type { ConfigService } from '@nestjs/config';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { SchedulerTaskConfig } from '@openlinker/core/sync';

const isEnabled = (configService: ConfigService, key: string): boolean =>
  configService.get<string>(key, 'true') !== 'false';

/**
 * Reads the `masterCatalogConnectionId` field off a connection's `config`
 * blob. Returns `null` if absent or non-string. Used by the offers-sync
 * task to scope offer→master-product linking on a per-connection basis.
 */
const getMasterCatalogConnectionId = (connection: Connection): string | null => {
  const config = connection.config as Record<string, unknown>;
  const masterConnectionId = config.masterCatalogConnectionId;
  return typeof masterConnectionId === 'string' ? masterConnectionId : null;
};

/**
 * Build the Allegro scheduler-task list. Returns 0–2 tasks depending on
 * the `OL_ALLEGRO_*_SCHEDULER_ENABLED` env-var gates.
 */
export function buildAllegroSchedulerTasks(configService: ConfigService): SchedulerTaskConfig[] {
  const tasks: SchedulerTaskConfig[] = [];

  if (isEnabled(configService, 'OL_ALLEGRO_POLL_SCHEDULER_ENABLED')) {
    const cronExpression = configService.get<string>(
      'OL_ALLEGRO_POLL_INTERVAL_CRON',
      '*/5 * * * *'
    );

    tasks.push({
      taskId: 'allegro-orders-poll',
      platformType: 'allegro',
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.orders.poll',
      cronExpression,
      enabledEnvVar: 'OL_ALLEGRO_POLL_SCHEDULER_ENABLED',
      generatePayload: () => ({
        schemaVersion: 1,
        cursorKey: 'allegro.orders.lastEventId',
        limit: 100,
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:orders:poll:${timestamp}`,
    });
  }

  if (isEnabled(configService, 'OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED')) {
    const cronExpression = configService.get<string>(
      'OL_ALLEGRO_OFFERS_SYNC_INTERVAL_CRON',
      '*/30 * * * *'
    );
    const pageLimitRaw = Number(
      configService.get<string>('OL_ALLEGRO_OFFERS_SYNC_PAGE_LIMIT', '100')
    );
    const pageLimit = Number.isFinite(pageLimitRaw) && pageLimitRaw > 0 ? pageLimitRaw : 100;
    const offersFeedTypeRaw = configService
      .get<string>('OL_ALLEGRO_OFFERS_SYNC_FEED_TYPE', 'events')
      .toLowerCase();
    const offersFeedType = offersFeedTypeRaw === 'offers' ? 'offers' : 'events';

    tasks.push({
      taskId: 'allegro-offers-sync',
      platformType: 'allegro',
      jobType: 'marketplace.offers.sync',
      cronExpression,
      enabledEnvVar: 'OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED',
      generatePayload: (connection) => {
        // Build only meaningful keys so the payload doesn't carry literal
        // `undefined` values (events-feed → cursorKey present; offers-feed
        // → cursorKey omitted entirely).
        const payload: Record<string, unknown> = {
          schemaVersion: 1,
          limit: pageLimit,
          cursor: null,
          feedType: offersFeedType,
          masterConnectionId: getMasterCatalogConnectionId(connection),
        };
        if (offersFeedType === 'events') {
          payload.cursorKey = 'allegro.offers.lastEventId';
        }
        return payload;
      },
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:offers:sync:${timestamp}`,
    });
  }

  if (isEnabled(configService, 'OL_ALLEGRO_OFFER_STATUS_SYNC_SCHEDULER_ENABLED')) {
    const cronExpression = configService.get<string>(
      'OL_ALLEGRO_OFFER_STATUS_SYNC_INTERVAL_CRON',
      '0 * * * *'
    );
    const pageLimitRaw = Number(
      configService.get<string>('OL_ALLEGRO_OFFER_STATUS_SYNC_PAGE_LIMIT', '100')
    );
    const pageLimit = Number.isFinite(pageLimitRaw) && pageLimitRaw > 0 ? pageLimitRaw : 100;

    tasks.push({
      taskId: 'allegro-offer-status-sync',
      platformType: 'allegro',
      jobType: 'marketplace.offer.statusSync',
      cronExpression,
      enabledEnvVar: 'OL_ALLEGRO_OFFER_STATUS_SYNC_SCHEDULER_ENABLED',
      generatePayload: () => ({
        schemaVersion: 1,
        limit: pageLimit,
        cursorKey: 'allegro.offerStatus.scanOffset',
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:offer:status:sync:${timestamp}`,
    });
  }

  if (isEnabled(configService, 'OL_ALLEGRO_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED')) {
    const cronExpression = configService.get<string>(
      'OL_ALLEGRO_SHIPMENT_STATUS_SYNC_INTERVAL_CRON',
      '0 */15 * * * *'
    );
    const pageLimitRaw = Number(
      configService.get<string>('OL_ALLEGRO_SHIPMENT_STATUS_SYNC_PAGE_LIMIT', '50')
    );
    const pageLimit = Number.isFinite(pageLimitRaw) && pageLimitRaw > 0 ? pageLimitRaw : 50;

    tasks.push({
      taskId: 'allegro-shipment-status-sync',
      platformType: 'allegro',
      jobType: 'marketplace.shipment.statusSync',
      cronExpression,
      enabledEnvVar: 'OL_ALLEGRO_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED',
      generatePayload: () => ({
        schemaVersion: 1,
        limit: pageLimit,
        cursorKey: 'allegro.shipmentStatus.scanOffset',
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `marketplace:${connection.id}:shipment:status:sync:${timestamp}`,
    });
  }

  return tasks;
}
