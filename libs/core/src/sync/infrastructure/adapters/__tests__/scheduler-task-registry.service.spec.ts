/**
 * Scheduler Task Registry Service — Unit Spec
 *
 * Covers the registry contract: register/getAll/has, overwrite semantics on
 * duplicate `taskId`, and snapshot-independence of `getAll()` (mutating the
 * returned array must not affect the registry's internal state).
 *
 * @module libs/core/src/sync/infrastructure/adapters/__tests__
 */
import { SchedulerTaskRegistryService } from '../scheduler-task-registry.service';
import { SchedulerTaskConfig } from '../../../domain/types/scheduler-task.types';

const makeTask = (taskId: string, overrides: Partial<SchedulerTaskConfig> = {}): SchedulerTaskConfig => ({
  taskId,
  platformType: 'test',
  jobType: 'marketplace.orders.poll',
  cronExpression: '*/5 * * * *',
  generatePayload: () => ({ schemaVersion: 1 }),
  generateIdempotencyKey: (c, t) => `${c.id}:${t}`,
  ...overrides,
});

describe('SchedulerTaskRegistryService', () => {
  let registry: SchedulerTaskRegistryService;

  beforeEach(() => {
    registry = new SchedulerTaskRegistryService();
  });

  describe('register / getAll', () => {
    it('should return an empty array before any registration', () => {
      expect(registry.getAll()).toEqual([]);
    });

    it('should expose every registered task via getAll()', () => {
      const a = makeTask('task-a');
      const b = makeTask('task-b');

      registry.register(a);
      registry.register(b);

      const all = registry.getAll();
      expect(all).toHaveLength(2);
      expect(all.map((t) => t.taskId).sort()).toEqual(['task-a', 'task-b']);
    });

    it('should silently overwrite a prior registration with the same taskId', () => {
      const first = makeTask('task-a', { cronExpression: '*/5 * * * *' });
      const second = makeTask('task-a', { cronExpression: '*/10 * * * *' });

      registry.register(first);
      registry.register(second);

      const all = registry.getAll();
      expect(all).toHaveLength(1);
      expect(all[0]?.cronExpression).toBe('*/10 * * * *');
    });

    it('should return a fresh array on each getAll() call so external mutation does not leak in', () => {
      registry.register(makeTask('task-a'));

      const snapshot = registry.getAll();
      snapshot.pop();

      expect(registry.getAll()).toHaveLength(1);
    });
  });

  describe('has', () => {
    it('should return false for an unregistered taskId', () => {
      expect(registry.has('missing')).toBe(false);
    });

    it('should return true after registration', () => {
      registry.register(makeTask('task-a'));
      expect(registry.has('task-a')).toBe(true);
    });
  });
});
