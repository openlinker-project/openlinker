/**
 * PrestaShop Scheduler Tasks — Unit Spec
 *
 * Covers `buildPrestashopSchedulerTasks`: enable-gate semantics for both
 * tasks, and the `prestashop-orders-poll` reconciliation-backstop task's
 * config (jobType, cursor key, cadence/limit overrides, idempotency key).
 *
 * @module libs/integrations/prestashop/src/infrastructure/scheduler/__tests__
 */
import type { ConfigService } from '@nestjs/config';
import { Connection } from '@openlinker/core/identifier-mapping';
import { buildPrestashopSchedulerTasks } from '../prestashop-scheduler-tasks';

const makeConfig = (overrides: Record<string, string> = {}): jest.Mocked<ConfigService> => {
  const get = jest.fn((key: string, defaultValue?: unknown) => {
    if (key in overrides) return overrides[key];
    return defaultValue;
  });
  return { get } as unknown as jest.Mocked<ConfigService>;
};

const makeConnection = (): Connection =>
  new Connection(
    'conn-ps-1',
    'prestashop',
    'Test PrestaShop',
    'active',
    {},
    'cred-ref',
    new Date(),
    new Date(),
    undefined,
    ['OrderSource', 'OrderProcessorManager']
  );

describe('buildPrestashopSchedulerTasks', () => {
  describe('enable gates', () => {
    it('should return both tasks by default (env-vars unset)', () => {
      const tasks = buildPrestashopSchedulerTasks(makeConfig());
      expect(tasks.map((t) => t.taskId)).toEqual([
        'prestashop-orders-poll',
        'prestashop-fulfillment-status-sync',
      ]);
    });

    it('should omit orders-poll when OL_PRESTASHOP_POLL_SCHEDULER_ENABLED=false', () => {
      const tasks = buildPrestashopSchedulerTasks(
        makeConfig({ OL_PRESTASHOP_POLL_SCHEDULER_ENABLED: 'false' })
      );
      expect(tasks.map((t) => t.taskId)).toEqual(['prestashop-fulfillment-status-sync']);
    });

    it('should keep orders-poll when only the fulfillment task is disabled', () => {
      const tasks = buildPrestashopSchedulerTasks(
        makeConfig({ OL_PRESTASHOP_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED: 'false' })
      );
      expect(tasks.map((t) => t.taskId)).toEqual(['prestashop-orders-poll']);
    });
  });

  describe('orders-poll task', () => {
    const ordersPoll = buildPrestashopSchedulerTasks(makeConfig()).find(
      (t) => t.taskId === 'prestashop-orders-poll'
    );

    it('should target platformType=prestashop and jobType=marketplace.orders.poll', () => {
      expect(ordersPoll?.platformType).toBe('prestashop');
      expect(ordersPoll?.jobType).toBe('marketplace.orders.poll');
      expect(ordersPoll?.enabledEnvVar).toBe('OL_PRESTASHOP_POLL_SCHEDULER_ENABLED');
    });

    it('should default to a relaxed 10-minute cadence', () => {
      expect(ordersPoll?.cronExpression).toBe('0 */10 * * * *');
    });

    it('should emit a payload with the PrestaShop orders cursor key and default limit 100', () => {
      expect(ordersPoll?.generatePayload(makeConnection())).toEqual({
        schemaVersion: 1,
        cursorKey: 'prestashop.orders.dateUpd',
        limit: 100,
      });
    });

    it('should generate a per-connection, per-tick idempotency key', () => {
      const key = ordersPoll?.generateIdempotencyKey(makeConnection(), '2026-05-31-12-34');
      expect(key).toBe('marketplace:conn-ps-1:orders:poll:2026-05-31-12-34');
    });

    it('should honour OL_PRESTASHOP_POLL_INTERVAL_CRON and _PAGE_LIMIT overrides', () => {
      const task = buildPrestashopSchedulerTasks(
        makeConfig({
          OL_PRESTASHOP_POLL_INTERVAL_CRON: '0 */15 * * * *',
          OL_PRESTASHOP_POLL_PAGE_LIMIT: '250',
        })
      ).find((t) => t.taskId === 'prestashop-orders-poll');

      expect(task?.cronExpression).toBe('0 */15 * * * *');
      expect(task?.generatePayload(makeConnection())).toMatchObject({ limit: 250 });
    });
  });
});
