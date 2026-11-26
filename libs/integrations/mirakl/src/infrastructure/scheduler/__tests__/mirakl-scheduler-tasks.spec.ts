/**
 * Mirakl Scheduler Tasks: unit tests
 *
 * @module libs/integrations/mirakl/src/infrastructure/scheduler
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import { empikOperatorProfile } from '../../../operators/empik.profile';
import { buildMiraklSchedulerTasks } from '../mirakl-scheduler-tasks';

describe('buildMiraklSchedulerTasks', () => {
  it('should register an env-gated orders poll for the operator', () => {
    const [task] = buildMiraklSchedulerTasks(empikOperatorProfile);

    expect(task).toMatchObject({
      taskId: 'empik-orders-poll',
      platformType: 'empik',
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.orders.poll',
      cronExpression: '*/5 * * * *',
      enabledEnvVar: 'OL_EMPIK_ORDERS_POLL_SCHEDULER_ENABLED',
    });
    expect(task.generatePayload({} as Connection)).toEqual({
      schemaVersion: 1,
      limit: 200,
      cursorKey: 'empik.orders.lastUpdateDate',
    });
    expect(task.generateIdempotencyKey({ id: 'conn-1' } as Connection, '2026-11-23T12:00')).toBe(
      'marketplace:conn-1:orders:poll:2026-11-23T12:00'
    );
  });

  it('should register the offer writes, offers sync and offer status tasks, each env-gated', () => {
    const tasks = buildMiraklSchedulerTasks(empikOperatorProfile);
    const byId = new Map(tasks.map((task) => [task.taskId, task]));

    expect([...byId.keys()]).toEqual([
      'empik-orders-poll',
      'empik-offer-writes',
      'empik-master-stock-writes',
      'empik-offers-sync',
      'empik-offer-status-sync',
      'empik-returns-poll',
      'empik-returns-status-sync',
    ]);
    expect(byId.get('empik-returns-poll')?.generatePayload({} as Connection)).toEqual({
      schemaVersion: 1,
      cursorKey: 'empik.returns.lastUpdateDate',
      limit: 100,
    });
    expect(byId.get('empik-returns-status-sync')).toMatchObject({
      requiredCapability: 'OrderSource',
      jobType: 'marketplace.returns.statusSync',
      enabledEnvVar: 'OL_EMPIK_RETURNS_STATUS_SYNC_SCHEDULER_ENABLED',
    });
    expect(byId.get('empik-offer-writes')).toMatchObject({
      requiredCapability: 'OfferManager',
      jobType: 'marketplace.offerQuantity.reconcile',
      enabledEnvVar: 'OL_EMPIK_OFFER_WRITES_SCHEDULER_ENABLED',
    });
    expect(byId.get('empik-master-stock-writes')).toMatchObject({
      requiredCapability: 'InventoryMaster',
      jobType: 'marketplace.offerQuantity.reconcile',
      cronExpression: '* * * * *',
      enabledEnvVar: 'OL_EMPIK_MASTER_STOCK_WRITES_SCHEDULER_ENABLED',
    });
    expect(
      byId
        .get('empik-offers-sync')
        ?.generatePayload({
          config: { masterCatalogConnectionId: 'master-1' },
        } as unknown as Connection)
    ).toEqual({
      schemaVersion: 1,
      limit: 100,
      cursor: null,
      feedType: 'offers',
      masterConnectionId: 'master-1',
    });
    expect(byId.get('empik-offer-status-sync')?.generatePayload({} as Connection)).toEqual({
      schemaVersion: 1,
      limit: 100,
      cursorKey: 'empik.offerStatus.scanOffset',
    });
  });
});
