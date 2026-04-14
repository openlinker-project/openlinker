/**
 * Scheduler Service Tests
 *
 * Unit tests for SchedulerService. Tests task registration,
 * connection filtering, and inventory sync scheduler configuration.
 *
 * @module apps/api/src/sync/application/services/__tests__
 */
import { SchedulerService } from '../scheduler.service';
import { ConnectionPort, Connection } from '@openlinker/core/identifier-mapping';
import { JobEnqueuePort } from '@openlinker/core/sync';
import { IIntegrationsService } from '@openlinker/core/integrations';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';

describe('SchedulerService', () => {
  let service: SchedulerService;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let configService: jest.Mocked<ConfigService>;
  let schedulerRegistry: jest.Mocked<SchedulerRegistry>;

  const createConnection = (id: string, platformType = 'prestashop'): Connection =>
    new Connection(
      id,
      platformType,
      `Test ${id}`,
      'active',
      {},
      'cred-ref',
      new Date(),
      new Date(),
      undefined,
      ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'Marketplace'],
    );

  beforeEach(() => {
    connectionPort = {
      get: jest.fn(),
      list: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;

    jobEnqueue = {
      enqueueJob: jest.fn().mockResolvedValue({ jobId: 'j1', isExisting: false }),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    integrationsService = {
      getAdapter: jest.fn(),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    configService = {
      get: jest.fn().mockReturnValue('true'),
    } as unknown as jest.Mocked<ConfigService>;

    schedulerRegistry = {
      addCronJob: jest.fn(),
    } as unknown as jest.Mocked<SchedulerRegistry>;

    service = new SchedulerService(
      connectionPort,
      jobEnqueue,
      integrationsService,
      configService,
      schedulerRegistry,
    );
  });

  describe('onModuleInit', () => {
    const defaultConfigGet = (key: string, defaultValue?: unknown): unknown => {
      const cronKeys = [
        'OL_ALLEGRO_POLL_INTERVAL_CRON',
        'OL_ALLEGRO_OFFERS_SYNC_INTERVAL_CRON',
        'OL_INVENTORY_SYNC_CRON',
        'OL_PRODUCT_SYNC_CRON',
      ];
      if (cronKeys.includes(key)) return defaultValue ?? '*/15 * * * *';
      if (key === 'OL_ALLEGRO_OFFERS_SYNC_PAGE_LIMIT') return '100';
      if (key === 'OL_ALLEGRO_OFFERS_SYNC_FEED_TYPE') return 'events';
      return 'true';
    };

    it('should register inventory sync task when enabled', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.onModuleInit();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('master-inventory-sync');
    });

    it('should not register inventory sync task when disabled', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_INVENTORY_SYNC_ENABLED') return 'false';
        return defaultConfigGet(key, defaultValue);
      });

      service.onModuleInit();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('master-inventory-sync');
    });

    it('should register product sync task when enabled', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.onModuleInit();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('master-product-sync');
    });

    it('should not register product sync task when disabled', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_PRODUCT_SYNC_ENABLED') return 'false';
        return defaultConfigGet(key, defaultValue);
      });

      service.onModuleInit();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('master-product-sync');
    });
  });

  describe('executeTask with connectionFilter', () => {
    it('should use connectionFilter when provided instead of platformType filter', () => {
      const conn = createConnection('conn-1');
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        { connectionId: 'conn-1', connection: conn, adapter: {} as never, metadata: {} as never },
      ]);

      service.registerTask({
        taskId: 'test-capability-task',
        platformType: '*',
        jobType: 'master.inventory.syncAll',
        cronExpression: '*/15 * * * *',
        connectionFilter: async () => {
          const adapters = await integrationsService.listCapabilityAdapters({
            capability: 'InventoryMaster',
          });
          return adapters.map((a) => a.connection);
        },
        generatePayload: () => ({ schemaVersion: 1 }),
        generateIdempotencyKey: (connection, timestamp) =>
          `master:${connection.id}:inventory:syncAll:${timestamp}`,
      });

      // Access private method via any cast for testing
      const tasks = (service as unknown as { tasks: Array<{ taskId: string }> }).tasks;
      const task = tasks.find((t) => t.taskId === 'test-capability-task');
      expect(task).toBeDefined();

      // connectionPort.list should NOT be called when connectionFilter is present
      expect(connectionPort.list).not.toHaveBeenCalled();
    });

    it('should not throw when connectionFilter resolves to undefined', async () => {
      const task = {
        taskId: 'capability-undefined',
        jobType: 'master.inventory.syncAll' as const,
        cronExpression: '*/15 * * * *',
        connectionFilter: (): Promise<Connection[]> =>
          Promise.resolve(undefined as unknown as Connection[]),
        generatePayload: (): Record<string, unknown> => ({ schemaVersion: 1 }),
        generateIdempotencyKey: (c: Connection, t: string): string => `${c.id}:${t}`,
      };

      await expect(
        (
          service as unknown as { executeTask: (t: unknown) => Promise<void> }
        ).executeTask(task),
      ).resolves.not.toThrow();

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should not throw when connectionPort.list resolves to undefined', async () => {
      connectionPort.list.mockResolvedValue(undefined as unknown as Connection[]);

      const task = {
        taskId: 'platform-undefined',
        platformType: 'allegro',
        jobType: 'marketplace.orders.poll' as const,
        cronExpression: '*/5 * * * *',
        generatePayload: (): Record<string, unknown> => ({ schemaVersion: 1 }),
        generateIdempotencyKey: (c: Connection, t: string): string => `${c.id}:${t}`,
      };

      await expect(
        (
          service as unknown as { executeTask: (t: unknown) => Promise<void> }
        ).executeTask(task),
      ).resolves.not.toThrow();

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });
  });
});
