/**
 * Allegro Scheduler Tasks — Unit Spec
 *
 * Covers `buildAllegroSchedulerTasks`: enable-gate semantics for each of
 * the three tasks, payload shape, idempotency key, and the
 * `masterCatalogConnectionId` lookup on the offers-sync payload.
 *
 * @module libs/integrations/allegro/src/infrastructure/scheduler/__tests__
 */
import type { ConfigService } from '@nestjs/config';
import { Connection } from '@openlinker/core/identifier-mapping';
import { buildAllegroSchedulerTasks } from '../allegro-scheduler-tasks';

const makeConfig = (overrides: Record<string, string> = {}): jest.Mocked<ConfigService> => {
  const get = jest.fn((key: string, defaultValue?: unknown) => {
    if (key in overrides) return overrides[key];
    return defaultValue;
  });
  return { get } as unknown as jest.Mocked<ConfigService>;
};

const makeConnection = (overrides: Partial<{ config: Record<string, unknown> }> = {}): Connection =>
  new Connection(
    'conn-allegro-1',
    'allegro',
    'Test Allegro',
    'active',
    overrides.config ?? {},
    'cred-ref',
    new Date(),
    new Date(),
    undefined,
    ['OrderSource', 'OfferManager']
  );

describe('buildAllegroSchedulerTasks', () => {
  describe('enable gates', () => {
    it('should return all four tasks by default (env-vars unset)', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      expect(tasks.map((t) => t.taskId)).toEqual([
        'allegro-orders-poll',
        'allegro-offers-sync',
        'allegro-offer-status-sync',
        'allegro-shipment-status-sync',
      ]);
    });

    it('should omit orders-poll when OL_ALLEGRO_POLL_SCHEDULER_ENABLED=false', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_POLL_SCHEDULER_ENABLED: 'false' })
      );
      expect(tasks.map((t) => t.taskId)).toEqual([
        'allegro-offers-sync',
        'allegro-offer-status-sync',
        'allegro-shipment-status-sync',
      ]);
    });

    it('should omit offers-sync when OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED=false', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED: 'false' })
      );
      expect(tasks.map((t) => t.taskId)).toEqual([
        'allegro-orders-poll',
        'allegro-offer-status-sync',
        'allegro-shipment-status-sync',
      ]);
    });

    it('should omit offer-status-sync when OL_ALLEGRO_OFFER_STATUS_SYNC_SCHEDULER_ENABLED=false', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_OFFER_STATUS_SYNC_SCHEDULER_ENABLED: 'false' })
      );
      expect(tasks.map((t) => t.taskId)).toEqual([
        'allegro-orders-poll',
        'allegro-offers-sync',
        'allegro-shipment-status-sync',
      ]);
    });

    it('should omit shipment-status-sync when OL_ALLEGRO_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED=false', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED: 'false' })
      );
      expect(tasks.map((t) => t.taskId)).toEqual([
        'allegro-orders-poll',
        'allegro-offers-sync',
        'allegro-offer-status-sync',
      ]);
    });

    it('should return an empty array when all env-vars are false', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({
          OL_ALLEGRO_POLL_SCHEDULER_ENABLED: 'false',
          OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED: 'false',
          OL_ALLEGRO_OFFER_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
          OL_ALLEGRO_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED: 'false',
        })
      );
      expect(tasks).toEqual([]);
    });
  });

  describe('orders-poll task', () => {
    const tasks = buildAllegroSchedulerTasks(makeConfig());
    const ordersPoll = tasks.find((t) => t.taskId === 'allegro-orders-poll');

    it('should target platformType=allegro and jobType=marketplace.orders.poll', () => {
      expect(ordersPoll?.platformType).toBe('allegro');
      expect(ordersPoll?.jobType).toBe('marketplace.orders.poll');
    });

    it('should emit a payload with the allegro orders cursor key and limit 100', () => {
      const connection = makeConnection();
      expect(ordersPoll?.generatePayload(connection)).toEqual({
        schemaVersion: 1,
        cursorKey: 'allegro.orders.lastEventId',
        limit: 100,
      });
    });

    it('should generate a per-connection, per-minute idempotency key', () => {
      const connection = makeConnection();
      const key = ordersPoll?.generateIdempotencyKey(connection, '2026-05-11-12-34');
      expect(key).toBe('marketplace:conn-allegro-1:orders:poll:2026-05-11-12-34');
    });

    it('should honour OL_ALLEGRO_POLL_INTERVAL_CRON override', () => {
      const tasks2 = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_POLL_INTERVAL_CRON: '*/2 * * * *' })
      );
      const orders = tasks2.find((t) => t.taskId === 'allegro-orders-poll');
      expect(orders?.cronExpression).toBe('*/2 * * * *');
    });
  });

  describe('offers-sync task', () => {
    it('should target platformType=allegro and jobType=marketplace.offers.sync', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      const offersSync = tasks.find((t) => t.taskId === 'allegro-offers-sync');
      expect(offersSync?.platformType).toBe('allegro');
      expect(offersSync?.jobType).toBe('marketplace.offers.sync');
    });

    it('should default feedType to events and emit the events cursor key', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      const offersSync = tasks.find((t) => t.taskId === 'allegro-offers-sync');
      const payload = offersSync?.generatePayload(makeConnection());
      expect(payload).toMatchObject({
        feedType: 'events',
        cursorKey: 'allegro.offers.lastEventId',
        limit: 100,
        cursor: null,
      });
    });

    it('should switch to feedType=offers without a cursor key when OL_ALLEGRO_OFFERS_SYNC_FEED_TYPE=offers', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_OFFERS_SYNC_FEED_TYPE: 'offers' })
      );
      const offersSync = tasks.find((t) => t.taskId === 'allegro-offers-sync');
      const payload = offersSync?.generatePayload(makeConnection());
      expect(payload).toMatchObject({ feedType: 'offers' });
      expect(payload?.cursorKey).toBeUndefined();
    });

    it('should fall back to limit=100 when OL_ALLEGRO_OFFERS_SYNC_PAGE_LIMIT is non-numeric', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_OFFERS_SYNC_PAGE_LIMIT: 'not-a-number' })
      );
      const offersSync = tasks.find((t) => t.taskId === 'allegro-offers-sync');
      const payload = offersSync?.generatePayload(makeConnection());
      expect(payload?.limit).toBe(100);
    });

    it('should propagate masterCatalogConnectionId from connection.config', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      const offersSync = tasks.find((t) => t.taskId === 'allegro-offers-sync');
      const connection = makeConnection({
        config: { masterCatalogConnectionId: 'conn-prestashop-master' },
      });
      const payload = offersSync?.generatePayload(connection);
      expect(payload?.masterConnectionId).toBe('conn-prestashop-master');
    });

    it('should emit masterConnectionId=null when config.masterCatalogConnectionId is missing or not a string', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      const offersSync = tasks.find((t) => t.taskId === 'allegro-offers-sync');
      expect(offersSync?.generatePayload(makeConnection())?.masterConnectionId).toBeNull();
      expect(
        offersSync?.generatePayload(makeConnection({ config: { masterCatalogConnectionId: 42 } }))
          ?.masterConnectionId
      ).toBeNull();
    });

    it('should generate a per-connection, per-minute idempotency key', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      const offersSync = tasks.find((t) => t.taskId === 'allegro-offers-sync');
      expect(offersSync?.generateIdempotencyKey(makeConnection(), '2026-05-11-12-34')).toBe(
        'marketplace:conn-allegro-1:offers:sync:2026-05-11-12-34'
      );
    });
  });

  describe('offer-status-sync task', () => {
    it('should target platformType=allegro and jobType=marketplace.offer.statusSync', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      const statusSync = tasks.find((t) => t.taskId === 'allegro-offer-status-sync');
      expect(statusSync?.platformType).toBe('allegro');
      expect(statusSync?.jobType).toBe('marketplace.offer.statusSync');
    });

    it('should default to an hourly cron and emit the scan-offset cursor key + limit 100', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      const statusSync = tasks.find((t) => t.taskId === 'allegro-offer-status-sync');
      expect(statusSync?.cronExpression).toBe('0 * * * *');
      expect(statusSync?.generatePayload(makeConnection())).toEqual({
        schemaVersion: 1,
        limit: 100,
        cursorKey: 'allegro.offerStatus.scanOffset',
      });
    });

    it('should honour OL_ALLEGRO_OFFER_STATUS_SYNC_INTERVAL_CRON override', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_OFFER_STATUS_SYNC_INTERVAL_CRON: '*/15 * * * *' })
      );
      const statusSync = tasks.find((t) => t.taskId === 'allegro-offer-status-sync');
      expect(statusSync?.cronExpression).toBe('*/15 * * * *');
    });

    it('should fall back to limit=100 when OL_ALLEGRO_OFFER_STATUS_SYNC_PAGE_LIMIT is non-numeric', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_OFFER_STATUS_SYNC_PAGE_LIMIT: 'not-a-number' })
      );
      const statusSync = tasks.find((t) => t.taskId === 'allegro-offer-status-sync');
      expect(statusSync?.generatePayload(makeConnection())?.limit).toBe(100);
    });

    it('should generate a per-connection, per-minute idempotency key', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      const statusSync = tasks.find((t) => t.taskId === 'allegro-offer-status-sync');
      expect(statusSync?.generateIdempotencyKey(makeConnection(), '2026-05-11-12-34')).toBe(
        'marketplace:conn-allegro-1:offer:status:sync:2026-05-11-12-34'
      );
    });
  });

  describe('shipment-status-sync task (#838)', () => {
    it('should target platformType=allegro and jobType=marketplace.shipment.statusSync', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      const shipSync = tasks.find((t) => t.taskId === 'allegro-shipment-status-sync');
      expect(shipSync?.platformType).toBe('allegro');
      expect(shipSync?.jobType).toBe('marketplace.shipment.statusSync');
    });

    it('should default to every-15-minute cron and emit the scan-offset cursor key + limit 50', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      const shipSync = tasks.find((t) => t.taskId === 'allegro-shipment-status-sync');
      expect(shipSync?.cronExpression).toBe('0 */15 * * * *');
      expect(shipSync?.generatePayload(makeConnection())).toEqual({
        schemaVersion: 1,
        limit: 50,
        cursorKey: 'allegro.shipmentStatus.scanOffset',
      });
    });

    it('should honour OL_ALLEGRO_SHIPMENT_STATUS_SYNC_INTERVAL_CRON override', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_SHIPMENT_STATUS_SYNC_INTERVAL_CRON: '*/5 * * * *' })
      );
      const shipSync = tasks.find((t) => t.taskId === 'allegro-shipment-status-sync');
      expect(shipSync?.cronExpression).toBe('*/5 * * * *');
    });

    it('should fall back to limit=50 when OL_ALLEGRO_SHIPMENT_STATUS_SYNC_PAGE_LIMIT is non-numeric', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_SHIPMENT_STATUS_SYNC_PAGE_LIMIT: 'not-a-number' })
      );
      const shipSync = tasks.find((t) => t.taskId === 'allegro-shipment-status-sync');
      expect(shipSync?.generatePayload(makeConnection())?.limit).toBe(50);
    });

    it('should generate a per-connection, per-minute idempotency key', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      const shipSync = tasks.find((t) => t.taskId === 'allegro-shipment-status-sync');
      expect(shipSync?.generateIdempotencyKey(makeConnection(), '2026-05-11-12-34')).toBe(
        'marketplace:conn-allegro-1:shipment:status:sync:2026-05-11-12-34'
      );
    });
  });
});
