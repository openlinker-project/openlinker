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
  it('should return the orders-poll + product-status-sync tasks', () => {
    const tasks = buildWooCommerceSchedulerTasks();
    expect(tasks.map((t) => t.taskId)).toEqual([
      'woocommerce-orders-poll',
      'woocommerce-product-status-sync',
    ]);
  });

  it('should have correct taskId', () => {
    const [task] = buildWooCommerceSchedulerTasks();
    expect(task.taskId).toBe('woocommerce-orders-poll');
  });

  describe('product-status-sync task (#1845)', () => {
    const statusTask = () =>
      buildWooCommerceSchedulerTasks().find(
        (t) => t.taskId === 'woocommerce-product-status-sync',
      )!;

    it('should be gated on the ProductPublisher capability and enqueue shop.product.statusSync', () => {
      const task = statusTask();
      expect(task.requiredCapability).toBe('ProductPublisher');
      expect(task.jobType).toBe('shop.product.statusSync');
      expect(task.enabledEnvVar).toBe('OL_WOOCOMMERCE_PRODUCT_STATUS_SYNC_SCHEDULER_ENABLED');
    });

    it('should build a V1 status-sync payload + shop-scoped idempotency key', () => {
      const task = statusTask();
      const conn = makeConnection();
      expect(task.generatePayload(conn)).toEqual({
        schemaVersion: 1,
        cursorKey: 'shop.productStatus.scanOffset',
        limit: 100,
      });
      expect(task.generateIdempotencyKey(conn, '2024-01-15-10-30')).toBe(
        `shop:${conn.id}:product:status:sync:2024-01-15-10-30`,
      );
    });
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
