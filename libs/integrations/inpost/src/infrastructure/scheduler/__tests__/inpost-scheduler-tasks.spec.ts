/**
 * InPost Scheduler Tasks — Unit Spec
 *
 * Covers `buildInpostSchedulerTasks`: the enable gate, task identity/scoping,
 * payload shape (incl. the disjoint cursor key), cron + page-limit defaults and
 * overrides, and the idempotency-key shape. Reads from `process.env`, so each
 * test mutates a restored copy.
 *
 * @module libs/integrations/inpost/src/infrastructure/scheduler/__tests__
 */
import { Connection } from '@openlinker/core/identifier-mapping';
import { buildInpostSchedulerTasks } from '../inpost-scheduler-tasks';

const ENV_KEYS = [
  'OL_INPOST_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED',
  'OL_INPOST_SHIPMENT_STATUS_SYNC_INTERVAL_CRON',
  'OL_INPOST_SHIPMENT_STATUS_SYNC_PAGE_LIMIT',
] as const;

const makeConnection = (): Connection =>
  new Connection(
    'conn-inpost-1',
    'inpost',
    'Test InPost',
    'active',
    {},
    'cred-ref',
    new Date(),
    new Date(),
    undefined,
    ['ShippingProviderManager'],
  );

describe('buildInpostSchedulerTasks', () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  describe('enable gate', () => {
    it('should register the shipment-status poll by default (env unset)', () => {
      const tasks = buildInpostSchedulerTasks();
      expect(tasks.map((t) => t.taskId)).toEqual(['inpost-shipment-status-sync']);
    });

    it('should omit the task when OL_INPOST_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED=false', () => {
      process.env.OL_INPOST_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED = 'false';
      expect(buildInpostSchedulerTasks()).toEqual([]);
    });

    it('should register the task for any non-"false" value', () => {
      process.env.OL_INPOST_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED = 'true';
      expect(buildInpostSchedulerTasks()).toHaveLength(1);
    });
  });

  describe('task shape', () => {
    it('should be platform-scoped to inpost on the shared shipment-status job', () => {
      const [task] = buildInpostSchedulerTasks();
      expect(task.platformType).toBe('inpost');
      expect(task.jobType).toBe('marketplace.shipment.statusSync');
      expect(task.enabledEnvVar).toBe('OL_INPOST_SHIPMENT_STATUS_SYNC_SCHEDULER_ENABLED');
    });

    it('should default to a 30-minute (6-field) cron', () => {
      const [task] = buildInpostSchedulerTasks();
      expect(task.cronExpression).toBe('0 */30 * * * *');
    });

    it('should honour an interval-cron override', () => {
      process.env.OL_INPOST_SHIPMENT_STATUS_SYNC_INTERVAL_CRON = '0 */5 * * * *';
      const [task] = buildInpostSchedulerTasks();
      expect(task.cronExpression).toBe('0 */5 * * * *');
    });
  });

  describe('payload', () => {
    it('should carry schemaVersion, default limit, and the disjoint cursor key', () => {
      const [task] = buildInpostSchedulerTasks();
      expect(task.generatePayload(makeConnection())).toEqual({
        schemaVersion: 1,
        limit: 50,
        cursorKey: 'inpost.shipmentStatus.scanOffset',
      });
    });

    it('should honour a page-limit override', () => {
      process.env.OL_INPOST_SHIPMENT_STATUS_SYNC_PAGE_LIMIT = '120';
      const [task] = buildInpostSchedulerTasks();
      expect(task.generatePayload(makeConnection())).toMatchObject({ limit: 120 });
    });

    it('should fall back to the default limit on a non-positive override', () => {
      process.env.OL_INPOST_SHIPMENT_STATUS_SYNC_PAGE_LIMIT = '0';
      const [task] = buildInpostSchedulerTasks();
      expect(task.generatePayload(makeConnection())).toMatchObject({ limit: 50 });
    });
  });

  describe('idempotency key', () => {
    it('should key per connection + timestamp', () => {
      const [task] = buildInpostSchedulerTasks();
      expect(task.generateIdempotencyKey(makeConnection(), '2026-06-05T03:00')).toBe(
        'marketplace:conn-inpost-1:shipment:status:sync:2026-06-05T03:00',
      );
    });
  });
});
