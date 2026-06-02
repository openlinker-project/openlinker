/**
 * @module libs/integrations/woocommerce/src/infrastructure/scheduler/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import { buildWooCommerceSchedulerTasks } from '../woocommerce-scheduler-tasks';

const makeConnection = (): Connection =>
  new Connection(
    'conn-wc-1',
    'woocommerce',
    'Test WooCommerce',
    'active',
    { siteUrl: 'https://myshop.example.com' },
    'cred-ref-001',
    new Date(),
    new Date(),
    undefined,
    ['OrderSource'],
  );

describe('buildWooCommerceSchedulerTasks', () => {
  it('should return exactly one task', () => {
    const tasks = buildWooCommerceSchedulerTasks();
    expect(tasks).toHaveLength(1);
  });

  it('should have correct taskId', () => {
    const [task] = buildWooCommerceSchedulerTasks();
    expect(task.taskId).toBe('woocommerce-orders-poll');
  });

  it('should declare the correct enabledEnvVar', () => {
    const [task] = buildWooCommerceSchedulerTasks();
    expect(task.enabledEnvVar).toBe('OL_WOOCOMMERCE_POLL_SCHEDULER_ENABLED');
  });

  it('should return a valid MarketplaceOrdersPollPayloadV1 payload', () => {
    const [task] = buildWooCommerceSchedulerTasks();
    const payload = task.generatePayload(makeConnection());
    expect(payload).toEqual({
      schemaVersion: 1,
      cursorKey: 'woocommerce.orders.lastModifiedAfter',
      limit: 100,
    });
  });

  it('should generate correct idempotency key', () => {
    const [task] = buildWooCommerceSchedulerTasks();
    const conn = makeConnection();
    const key = task.generateIdempotencyKey(conn, '2024-01-15-10-30');
    expect(key).toBe(`marketplace:${conn.id}:wc:orders:poll:2024-01-15-10-30`);
  });
});
