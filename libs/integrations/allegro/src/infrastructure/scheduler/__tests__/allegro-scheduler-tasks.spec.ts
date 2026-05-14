/**
 * Allegro Scheduler Tasks — Unit Spec
 *
 * Covers `buildAllegroSchedulerTasks`: enable-gate semantics for each of
 * the two tasks, payload shape, idempotency key, and the
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
    it('should return both tasks by default (env-vars unset)', () => {
      const tasks = buildAllegroSchedulerTasks(makeConfig());
      expect(tasks.map((t) => t.taskId)).toEqual(['allegro-orders-poll', 'allegro-offers-sync']);
    });

    it('should omit orders-poll when OL_ALLEGRO_POLL_SCHEDULER_ENABLED=false', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_POLL_SCHEDULER_ENABLED: 'false' })
      );
      expect(tasks.map((t) => t.taskId)).toEqual(['allegro-offers-sync']);
    });

    it('should omit offers-sync when OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED=false', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({ OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED: 'false' })
      );
      expect(tasks.map((t) => t.taskId)).toEqual(['allegro-orders-poll']);
    });

    it('should return an empty array when both env-vars are false', () => {
      const tasks = buildAllegroSchedulerTasks(
        makeConfig({
          OL_ALLEGRO_POLL_SCHEDULER_ENABLED: 'false',
          OL_ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED: 'false',
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
});
