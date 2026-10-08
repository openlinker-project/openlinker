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
  const [task] = buildShoperSchedulerTasks();

  it('should register exactly the orders-poll task, gated on OrderSource', () => {
    expect(buildShoperSchedulerTasks()).toHaveLength(1);
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
});
