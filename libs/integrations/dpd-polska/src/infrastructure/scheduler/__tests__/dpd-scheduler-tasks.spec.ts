/**
 * DPD Scheduler Tasks — unit tests
 *
 * Verifies the env gate, the default task shape, and the cron/page-limit
 * overrides (#965).
 *
 * @module libs/integrations/dpd-polska/src/infrastructure/scheduler
 */
import type { Connection } from '@openlinker/core/identifier-mapping';
import { buildDpdSchedulerTasks } from '../dpd-scheduler-tasks';

// generatePayload ignores the connection (it builds a static payload), so a
// minimal stub is sufficient for the contract call.
const CONN = { id: 'conn-dpd', platformType: 'dpd' } as unknown as Connection;

const ENV_KEYS = [
  'OL_DPD_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED',
  'OL_DPD_SHIPMENT_STATUS_SYNC_INTERVAL_CRON',
  'OL_DPD_SHIPMENT_STATUS_SYNC_PAGE_LIMIT',
];

describe('buildDpdSchedulerTasks', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = saved[k];
      }
    }
  });

  it('emits one task with the DPD defaults when unset (enabled by default)', () => {
    const tasks = buildDpdSchedulerTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      taskId: 'dpd-shipment-status-sync',
      platformType: 'dpd',
      jobType: 'marketplace.shipment.statusSync',
      cronExpression: '0 */30 * * * *',
      enabledEnvVar: 'OL_DPD_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED',
    });
    expect(tasks[0].generatePayload(CONN)).toEqual({
      schemaVersion: 1,
      limit: 50,
      cursorKey: 'dpd.shipmentStatus.scanOffset',
    });
  });

  it('emits no task when explicitly disabled', () => {
    process.env.OL_DPD_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED = 'false';
    expect(buildDpdSchedulerTasks()).toHaveLength(0);
  });

  it('honours cron + page-limit overrides', () => {
    process.env.OL_DPD_SHIPMENT_STATUS_SYNC_INTERVAL_CRON = '0 0 */2 * * *';
    process.env.OL_DPD_SHIPMENT_STATUS_SYNC_PAGE_LIMIT = '25';
    const [task] = buildDpdSchedulerTasks();
    expect(task.cronExpression).toBe('0 0 */2 * * *');
    expect(task.generatePayload(CONN)).toMatchObject({ limit: 25 });
  });
});
