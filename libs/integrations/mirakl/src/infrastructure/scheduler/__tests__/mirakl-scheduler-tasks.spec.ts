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
      'marketplace:conn-1:orders:poll:2026-11-23T12:00',
    );
  });
});
