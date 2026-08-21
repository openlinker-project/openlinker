/**
 * Sync Jobs Service Unit Tests
 *
 * Pass-through assertions for `schedule` — verifies the service forwards
 * `(jobType, connectionId, payload, idempotencyKey, maxAttempts)` and
 * `{ runAfter }` to `SyncJobRepositoryPort.createIfNotExistsByIdempotencyKey`
 * unchanged.
 *
 * @module libs/core/src/sync/application/services
 */
import { SyncJobsService } from './sync-jobs.service';
import type { SyncJobRepositoryPort } from '../../domain/ports/sync-job-repository.port';
import type { SyncJob } from '../../domain/entities/sync-job.entity';
import type { SchedulerTaskConfig } from '../../domain/types/scheduler-task.types';
import type { SchedulerTaskRegistryService } from '../../infrastructure/adapters/scheduler-task-registry.service';
import type { ScheduleJobInput } from './sync-jobs.types';

function makeTask(overrides: Partial<SchedulerTaskConfig> = {}): SchedulerTaskConfig {
  return {
    taskId: 'test-task',
    platformType: 'allegro',
    jobType: 'marketplace.orders.poll',
    cronExpression: '*/5 * * * *',
    generatePayload: () => ({}),
    generateIdempotencyKey: () => 'key',
    ...overrides,
  };
}

describe('SyncJobsService', () => {
  let repository: jest.Mocked<
    Pick<
      SyncJobRepositoryPort,
      | 'createIfNotExistsByIdempotencyKey'
      | 'requeueDeadByIdempotencyKey'
      | 'findLastSucceededByConnectionAndJobType'
    >
  >;
  let schedulerTaskRegistry: jest.Mocked<Pick<SchedulerTaskRegistryService, 'getAll'>>;
  let service: SyncJobsService;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    repository = {
      createIfNotExistsByIdempotencyKey: jest.fn(),
      requeueDeadByIdempotencyKey: jest.fn(),
      findLastSucceededByConnectionAndJobType: jest.fn(),
    };
    schedulerTaskRegistry = { getAll: jest.fn().mockReturnValue([]) };
    service = new SyncJobsService(
      repository as unknown as SyncJobRepositoryPort,
      schedulerTaskRegistry as unknown as SchedulerTaskRegistryService
    );
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('schedule', () => {
    it('forwards (input fields, runAfter) to createIfNotExistsByIdempotencyKey', async () => {
      const runAfter = new Date('2026-06-01T00:00:00.000Z');
      const input: ScheduleJobInput = {
        jobType: 'marketplace.offer.pollCreationStatus',
        connectionId: 'conn-1',
        payload: { foo: 'bar' },
        idempotencyKey: 'pollCreationStatus:rec-1:1',
        maxAttempts: 3,
        runAfter,
      };
      const persisted = { id: 'job-1' } as SyncJob;
      repository.createIfNotExistsByIdempotencyKey.mockResolvedValue(persisted);

      const result = await service.schedule(input);

      expect(result).toBe(persisted);
      expect(repository.createIfNotExistsByIdempotencyKey).toHaveBeenCalledTimes(1);
      expect(repository.createIfNotExistsByIdempotencyKey).toHaveBeenCalledWith(
        {
          jobType: input.jobType,
          connectionId: input.connectionId,
          payload: input.payload,
          idempotencyKey: input.idempotencyKey,
          maxAttempts: input.maxAttempts,
        },
        { runAfter }
      );
    });

    it('forwards a different maxAttempts value verbatim', async () => {
      const runAfter = new Date('2026-06-01T00:00:00.000Z');
      repository.createIfNotExistsByIdempotencyKey.mockResolvedValue({ id: 'job-x' } as SyncJob);

      await service.schedule({
        jobType: 'marketplace.offer.pollCreationStatus',
        connectionId: 'conn-1',
        payload: {},
        idempotencyKey: 'key',
        maxAttempts: 7,
        runAfter,
      });

      const [arg0] = repository.createIfNotExistsByIdempotencyKey.mock.calls[0];
      expect(arg0.maxAttempts).toBe(7);
    });
  });

  describe('requeueDeadByIdempotencyKey (#1585 I3 / S3)', () => {
    it('delegates to the guarded repo update and returns true when a dead job was requeued', async () => {
      repository.requeueDeadByIdempotencyKey.mockResolvedValue(true);

      const result = await service.requeueDeadByIdempotencyKey('invoice:c:o');

      expect(result).toBe(true);
      expect(repository.requeueDeadByIdempotencyKey).toHaveBeenCalledWith('invoice:c:o');
    });

    it('returns false when the guarded update matched no dead job (absent / non-dead)', async () => {
      repository.requeueDeadByIdempotencyKey.mockResolvedValue(false);

      const result = await service.requeueDeadByIdempotencyKey('missing');

      expect(result).toBe(false);
      expect(repository.requeueDeadByIdempotencyKey).toHaveBeenCalledWith('missing');
    });
  });

  describe('findLastSucceededJob (#1982)', () => {
    it('delegates to the repository and returns the matching job', async () => {
      const job = { id: 'job-1' } as SyncJob;
      repository.findLastSucceededByConnectionAndJobType.mockResolvedValue(job);

      const result = await service.findLastSucceededJob('conn-1', 'marketplace.orders.poll');

      expect(result).toBe(job);
      expect(repository.findLastSucceededByConnectionAndJobType).toHaveBeenCalledWith(
        'conn-1',
        'marketplace.orders.poll'
      );
    });

    it('returns null when no succeeded job exists for the connection + job type', async () => {
      repository.findLastSucceededByConnectionAndJobType.mockResolvedValue(null);

      const result = await service.findLastSucceededJob('conn-1', 'marketplace.orders.poll');

      expect(result).toBeNull();
    });
  });

  describe('findEnabledPollTask (#1982)', () => {
    it('returns the matching task when no enabledEnvVar is set (defaults to enabled)', () => {
      schedulerTaskRegistry.getAll.mockReturnValue([makeTask()]);

      const result = service.findEnabledPollTask('allegro', 'marketplace.orders.poll');

      expect(result?.taskId).toBe('test-task');
    });

    it('returns null when no task is registered for the platform', () => {
      schedulerTaskRegistry.getAll.mockReturnValue([makeTask({ platformType: 'allegro' })]);

      const result = service.findEnabledPollTask('prestashop', 'marketplace.orders.poll');

      expect(result).toBeNull();
    });

    it('returns the task when enabledEnvVar is unset in the environment (falls back to enabled)', () => {
      delete process.env.OL_PRESTASHOP_POLL_SCHEDULER_ENABLED;
      schedulerTaskRegistry.getAll.mockReturnValue([
        makeTask({ platformType: 'prestashop', enabledEnvVar: 'OL_PRESTASHOP_POLL_SCHEDULER_ENABLED' }),
      ]);

      const result = service.findEnabledPollTask('prestashop', 'marketplace.orders.poll');

      expect(result).not.toBeNull();
    });

    it('returns null when enabledEnvVar is literally "false" — a disabled task is not a cadence source', () => {
      process.env.OL_PRESTASHOP_POLL_SCHEDULER_ENABLED = 'false';
      schedulerTaskRegistry.getAll.mockReturnValue([
        makeTask({ platformType: 'prestashop', enabledEnvVar: 'OL_PRESTASHOP_POLL_SCHEDULER_ENABLED' }),
      ]);

      const result = service.findEnabledPollTask('prestashop', 'marketplace.orders.poll');

      expect(result).toBeNull();
    });

    it('returns null when enabledDefault is false and the env var is unset (opt-in task never enabled by default)', () => {
      delete process.env.OL_SOME_OPT_IN_TASK_ENABLED;
      schedulerTaskRegistry.getAll.mockReturnValue([
        makeTask({
          platformType: 'allegro',
          enabledEnvVar: 'OL_SOME_OPT_IN_TASK_ENABLED',
          enabledDefault: false,
        }),
      ]);

      const result = service.findEnabledPollTask('allegro', 'marketplace.orders.poll');

      expect(result).toBeNull();
    });

    it('does not match a task with a different jobType', () => {
      schedulerTaskRegistry.getAll.mockReturnValue([
        makeTask({ jobType: 'marketplace.offers.sync' }),
      ]);

      const result = service.findEnabledPollTask('allegro', 'marketplace.orders.poll');

      expect(result).toBeNull();
    });
  });

  describe('findEnabledTaskByJobType (#2258)', () => {
    it('matches a capability-scoped task that carries no platformType', () => {
      schedulerTaskRegistry.getAll.mockReturnValue([
        makeTask({
          taskId: 'master-product-delta-sync',
          jobType: 'master.product.syncDelta',
          platformType: undefined,
        }),
      ]);

      const result = service.findEnabledTaskByJobType('master.product.syncDelta');

      expect(result?.taskId).toBe('master-product-delta-sync');
    });

    it('returns null when the task is registered but disabled via enabledEnvVar/enabledDefault', () => {
      delete process.env.OL_MASTER_PRODUCT_DELTA_SYNC_ENABLED;
      schedulerTaskRegistry.getAll.mockReturnValue([
        makeTask({
          jobType: 'master.product.syncDelta',
          platformType: undefined,
          enabledEnvVar: 'OL_MASTER_PRODUCT_DELTA_SYNC_ENABLED',
          enabledDefault: false,
        }),
      ]);

      const result = service.findEnabledTaskByJobType('master.product.syncDelta');

      expect(result).toBeNull();
    });

    it('returns null when no task is registered for the job type', () => {
      schedulerTaskRegistry.getAll.mockReturnValue([]);

      const result = service.findEnabledTaskByJobType('master.product.syncDelta');

      expect(result).toBeNull();
    });

    it('returns the first ENABLED match when several tasks share the job type', () => {
      process.env.OL_FIRST_TASK_DISABLED = 'false';
      schedulerTaskRegistry.getAll.mockReturnValue([
        makeTask({
          taskId: 'disabled-one',
          jobType: 'master.product.syncDelta',
          platformType: undefined,
          enabledEnvVar: 'OL_FIRST_TASK_DISABLED',
        }),
        makeTask({
          taskId: 'enabled-one',
          jobType: 'master.product.syncDelta',
          platformType: undefined,
        }),
      ]);

      const result = service.findEnabledTaskByJobType('master.product.syncDelta');
      // Cleared before the assertion so a failure cannot leak the var into
      // later tests that rely on unset env defaults.
      delete process.env.OL_FIRST_TASK_DISABLED;

      expect(result?.taskId).toBe('enabled-one');
    });
  });
});
