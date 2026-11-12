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
});
