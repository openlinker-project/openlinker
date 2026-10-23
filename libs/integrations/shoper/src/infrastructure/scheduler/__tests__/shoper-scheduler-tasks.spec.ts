/**
 * @module libs/integrations/shoper/src/infrastructure/scheduler/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import { buildShoperSchedulerTasks } from '../shoper-scheduler-tasks';

const connection = new Connection(
  'conn-shoper-1',
  'shoper',
  'Test Shoper',
  'active',
  { baseUrl: 'https://shop.example.com' },
  'cred-ref-001',
  new Date(),
  new Date(),
  undefined,
  ['OrderSource'],
);

describe('buildShoperSchedulerTasks', () => {
  const [task, fulfillment] = buildShoperSchedulerTasks();

  it('should register the orders poll and the fulfilment read-back, and nothing else', () => {
    expect(buildShoperSchedulerTasks().map((t) => t.taskId)).toEqual([
      'shoper-orders-poll',
      'shoper-fulfillment-status-sync',
    ]);
  });

  it('should gate the orders poll on OrderSource', () => {
    expect(task.taskId).toBe('shoper-orders-poll');
    expect(task.platformType).toBe('shoper');
    expect(task.requiredCapability).toBe('OrderSource');
    expect(task.jobType).toBe('marketplace.orders.poll');
  });

  it('should be switchable off through its env var and default to on', () => {
    expect(task.enabledEnvVar).toBe('OL_SHOPER_POLL_SCHEDULER_ENABLED');
    expect(task.enabledDefault).toBeUndefined();
  });

  it('should poll with a versioned payload and its own cursor key', () => {
    expect(task.generatePayload(connection)).toEqual({
      schemaVersion: 1,
      cursorKey: 'shoper.orders.lastOrderId',
      limit: 100,
    });
  });

  it('should key every tick per connection and timestamp so ticks never dedupe each other', () => {
    expect(task.generateIdempotencyKey(connection, '2026-10-06T14:10')).toBe(
      'marketplace:conn-shoper-1:shoper:orders:poll:2026-10-06T14:10',
    );
    expect(task.generateIdempotencyKey(connection, 'a')).not.toBe(
      task.generateIdempotencyKey(connection, 'b'),
    );
  });

  describe('fulfillment status sync', () => {
    it('should read back shipments only for a shop that receives orders', () => {
      expect(fulfillment.platformType).toBe('shoper');
      expect(fulfillment.requiredCapability).toBe('OrderProcessorManager');
      expect(fulfillment.jobType).toBe('marketplace.fulfillment.statusSync');
      expect(fulfillment.cronExpression).toBe('*/15 * * * *');
    });

    it('should be switchable off through its own env var and default to on', () => {
      expect(fulfillment.enabledEnvVar).toBe('OL_SHOPER_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED');
      expect(fulfillment.enabledDefault).toBeUndefined();
    });

    it('should page with its own scan-offset cursor key', () => {
      expect(fulfillment.generatePayload(connection)).toEqual({
        schemaVersion: 1,
        limit: 100,
        cursorKey: 'shoper.fulfillmentStatus.scanOffset',
        updatedSinceDays: 30,
      });
      expect(fulfillment.generateIdempotencyKey(connection, 't1')).toBe(
        'marketplace:conn-shoper-1:shoper:fulfillment:status:sync:t1',
      );
    });
  });
});
