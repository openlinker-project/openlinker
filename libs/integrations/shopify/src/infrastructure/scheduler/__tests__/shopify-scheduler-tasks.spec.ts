import type { Connection } from '@openlinker/core/identifier-mapping';

import { buildShopifySchedulerTasks } from '../shopify-scheduler-tasks';

describe('buildShopifySchedulerTasks', () => {
  const tasks = buildShopifySchedulerTasks();
  const byId = new Map(tasks.map((t) => [t.taskId, t]));

  it('should poll orders under its own cursor key, never the core default (C22)', () => {
    const poll = byId.get('shopify-orders-poll');

    expect(poll).toMatchObject({ jobType: 'marketplace.orders.poll', requiredCapability: 'OrderSource' });
    expect(poll?.generatePayload({ id: 'c1' } as Connection)).toMatchObject({ cursorKey: 'shopify.orders.cursor' });
  });

  it('should keep both returns passes off by default and gated on OrderSource, never on the sub-capability', () => {
    for (const id of ['shopify-returns-poll', 'shopify-returns-status-sync']) {
      expect(byId.get(id)).toMatchObject({ requiredCapability: 'OrderSource', enabledDefault: false });
    }
  });

  it('should read the copy fulfillment back on a connection that receives orders', () => {
    expect(byId.get('shopify-fulfillment-status-sync')).toMatchObject({
      jobType: 'marketplace.fulfillment.statusSync',
      requiredCapability: 'OrderProcessorManager',
    });
  });

  it('should read back a source-side fulfilment hourly, ON by default, under its own cursor, gated on OrderSource', () => {
    const task = byId.get('shopify-source-fulfillment-status-sync');

    expect(task).toMatchObject({
      jobType: 'marketplace.sourceFulfillment.statusSync',
      requiredCapability: 'OrderSource',
      cronExpression: '20 * * * *',
      enabledEnvVar: 'OL_SHOPIFY_SOURCE_FULFILLMENT_STATUS_SYNC_SCHEDULER_ENABLED',
    });
    expect(task?.enabledDefault).toBeUndefined();
    expect(task?.generatePayload({ id: 'c1' } as Connection)).toMatchObject({
      cursorKey: 'shopify.sourceFulfillmentStatus.scanOffset',
      updatedSinceDays: 30,
    });
    expect(task?.generateIdempotencyKey({ id: 'c1' } as Connection, 't')).toBe(
      'marketplace:c1:shopify:source:fulfillment:status:sync:t',
    );
  });

  it('should reconcile published product status hourly under its own cursor, gated on ProductPublisher', () => {
    const task = byId.get('shopify-product-status-sync');

    expect(task).toMatchObject({
      jobType: 'shop.product.statusSync',
      requiredCapability: 'ProductPublisher',
      cronExpression: '0 * * * *',
      enabledEnvVar: 'OL_SHOPIFY_PRODUCT_STATUS_SYNC_SCHEDULER_ENABLED',
    });
    expect(task?.enabledDefault).toBeUndefined();
    expect(task?.generatePayload({ id: 'c1' } as Connection)).toMatchObject({
      cursorKey: 'shop.productStatus.scanOffset',
      limit: 100,
    });
  });
});
