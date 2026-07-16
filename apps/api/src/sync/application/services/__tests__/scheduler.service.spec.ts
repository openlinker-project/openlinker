/**
 * Scheduler Service Tests
 *
 * Unit tests for SchedulerService. Covers the two core capability-based
 * tasks (inventory + product), the registry-drain bootstrap path that
 * picks up plugin-contributed tasks (#584), executeTask scope routing,
 * and onModuleDestroy teardown.
 *
 * @module apps/api/src/sync/application/services/__tests__
 */
import { SchedulerService } from '../scheduler.service';
import type { ConnectionPort } from '@openlinker/core/identifier-mapping';
import { Connection } from '@openlinker/core/identifier-mapping';
import type { JobEnqueuePort, SchedulerTaskConfig } from '@openlinker/core/sync';
import { SchedulerTaskRegistryService } from '@openlinker/core/sync';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { ConfigService } from '@nestjs/config';

describe('SchedulerService', () => {
  let service: SchedulerService;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let configService: jest.Mocked<ConfigService>;
  let schedulerRegistry: jest.Mocked<SchedulerRegistry>;
  let schedulerTaskRegistry: SchedulerTaskRegistryService;

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
      ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager']
    );

  const makeTask = (
    taskId: string,
    overrides: Partial<SchedulerTaskConfig> = {}
  ): SchedulerTaskConfig => ({
    taskId,
    platformType: 'allegro',
    jobType: 'marketplace.orders.poll',
    cronExpression: '*/5 * * * *',
    generatePayload: () => ({ schemaVersion: 1 }),
    generateIdempotencyKey: (c, t) => `${c.id}:${t}`,
    ...overrides,
  });

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
      getCronJobs: jest.fn().mockReturnValue(new Map()),
      deleteCronJob: jest.fn(),
    } as unknown as jest.Mocked<SchedulerRegistry>;

    schedulerTaskRegistry = new SchedulerTaskRegistryService();

    service = new SchedulerService(
      connectionPort,
      jobEnqueue,
      integrationsService,
      configService,
      schedulerRegistry,
      schedulerTaskRegistry
    );
  });

  describe('onApplicationBootstrap', () => {
    const defaultConfigGet = (key: string, defaultValue?: unknown): unknown => {
      const cronKeys = [
        'OL_INVENTORY_SYNC_CRON',
        'OL_PRODUCT_SYNC_CRON',
        'OL_PICKUP_POINT_REFRESH_CRON',
        'OL_REGULATORY_RECONCILE_CRON',
      ];
      if (cronKeys.includes(key)) return defaultValue ?? '*/15 * * * *';
      return 'true';
    };

    it('should register the core inventory sync task when enabled', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.onApplicationBootstrap();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('master-inventory-sync');
    });

    it('should not register the core inventory sync task when disabled', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_INVENTORY_SYNC_ENABLED') return 'false';
        return defaultConfigGet(key, defaultValue);
      });

      service.onApplicationBootstrap();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('master-inventory-sync');
    });

    it('should register the core product sync task when enabled', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.onApplicationBootstrap();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('master-product-sync');
    });

    it('should not register the core product sync task when disabled', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_PRODUCT_SYNC_ENABLED') return 'false';
        return defaultConfigGet(key, defaultValue);
      });

      service.onApplicationBootstrap();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('master-product-sync');
    });

    it('should schedule plugin-contributed tasks drained from the registry', () => {
      configService.get.mockImplementation(defaultConfigGet);
      schedulerTaskRegistry.register(makeTask('plugin-orders-poll'));
      schedulerTaskRegistry.register(
        makeTask('plugin-offers-sync', { cronExpression: '*/30 * * * *' })
      );

      service.onApplicationBootstrap();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('plugin-orders-poll');
      expect(registeredJobs).toContain('plugin-offers-sync');
    });

    it('should not carry any allegro-specific task knowledge in core', () => {
      // Regression guard for #584: with an empty registry the scheduler must
      // register *only* the capability-based core tasks. The previous
      // implementation hardcoded `allegro-orders-poll` and `allegro-offers-sync`
      // here; both must now be contributed by AllegroIntegrationModule.
      configService.get.mockImplementation(defaultConfigGet);

      service.onApplicationBootstrap();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs.sort()).toEqual([
        'master-inventory-sync',
        'master-product-sync',
        'offline-resubmit',
        'pending-recovery',
        'pickup-point-refresh',
        'regulatory-status-reconcile',
      ]);
    });

    it('should skip a registry-contributed task whose enabledEnvVar resolves to false', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_PLUGIN_TASK_ENABLED') return 'false';
        return defaultConfigGet(key, defaultValue);
      });
      schedulerTaskRegistry.register(
        makeTask('gated-plugin-task', { enabledEnvVar: 'OL_PLUGIN_TASK_ENABLED' })
      );

      service.onApplicationBootstrap();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('gated-plugin-task');
    });
  });

  describe('onModuleDestroy', () => {
    it('should stop and deregister all registered cron jobs', () => {
      const mockStopA = jest.fn();
      const mockStopB = jest.fn();
      const cronJobs = new Map([
        ['allegro-orders-poll', { stop: mockStopA }],
        ['master-inventory-sync', { stop: mockStopB }],
      ]);
      schedulerRegistry.getCronJobs.mockReturnValue(
        cronJobs as unknown as ReturnType<SchedulerRegistry['getCronJobs']>
      );

      service.onModuleDestroy();

      expect(mockStopA).toHaveBeenCalledTimes(1);
      expect(mockStopB).toHaveBeenCalledTimes(1);
      expect(schedulerRegistry.deleteCronJob).toHaveBeenCalledWith('allegro-orders-poll');
      expect(schedulerRegistry.deleteCronJob).toHaveBeenCalledWith('master-inventory-sync');
    });

    it('should not throw when there are no registered cron jobs', () => {
      schedulerRegistry.getCronJobs.mockReturnValue(new Map());

      expect(() => service.onModuleDestroy()).not.toThrow();
    });

    it('should not throw when stopping a cron job fails', () => {
      const cronJobs = new Map([
        [
          'bad-job',
          {
            stop: jest.fn().mockImplementation(() => {
              throw new Error('stop failed');
            }),
          },
        ],
      ]);
      schedulerRegistry.getCronJobs.mockReturnValue(
        cronJobs as unknown as ReturnType<SchedulerRegistry['getCronJobs']>
      );

      expect(() => service.onModuleDestroy()).not.toThrow();
    });
  });

  describe('executeTask routing (private — accessed via type cast)', () => {
    it('should fan out via connectionFilter when present and skip the platformType branch', async () => {
      const conn = createConnection('conn-1');
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        { connectionId: 'conn-1', connection: conn, adapter: {} as never, metadata: {} as never },
      ]);
      const task: SchedulerTaskConfig = {
        taskId: 'test-capability-task',
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
      };

      await (
        service as unknown as { executeTask: (t: SchedulerTaskConfig) => Promise<void> }
      ).executeTask(task);

      expect(connectionPort.list).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
    });

    it('should not throw when connectionFilter resolves to undefined', async () => {
      const task: SchedulerTaskConfig = {
        taskId: 'capability-undefined',
        jobType: 'master.inventory.syncAll',
        cronExpression: '*/15 * * * *',
        connectionFilter: (): Promise<Connection[]> =>
          Promise.resolve(undefined as unknown as Connection[]),
        generatePayload: () => ({ schemaVersion: 1 }),
        generateIdempotencyKey: (c, t) => `${c.id}:${t}`,
      };

      await expect(
        (
          service as unknown as { executeTask: (t: SchedulerTaskConfig) => Promise<void> }
        ).executeTask(task)
      ).resolves.not.toThrow();

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should skip a platformType-scoped connection missing requiredCapability (#1452 no-starvation follow-up)', async () => {
      const withCapability = createConnection('conn-with', 'woocommerce');
      const withoutCapability = new Connection(
        'conn-without',
        'woocommerce',
        'Test conn-without',
        'active',
        {},
        'cred-ref',
        new Date(),
        new Date(),
        undefined,
        ['ProductPublisher', 'CategoryProvisioner']
      );
      connectionPort.list.mockResolvedValue([withCapability, withoutCapability]);
      const task = makeTask('woocommerce-orders-poll', {
        platformType: 'woocommerce',
        requiredCapability: 'OrderSource',
      });

      await (
        service as unknown as { executeTask: (t: SchedulerTaskConfig) => Promise<void> }
      ).executeTask(task);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'conn-with' })
      );
    });

    it('should enqueue for every connection when requiredCapability is absent (backward-compatible default)', async () => {
      const conn = createConnection('conn-1', 'allegro');
      connectionPort.list.mockResolvedValue([conn]);
      const task = makeTask('allegro-orders-poll');

      await (
        service as unknown as { executeTask: (t: SchedulerTaskConfig) => Promise<void> }
      ).executeTask(task);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
    });

    it('should not throw when connectionPort.list resolves to undefined', async () => {
      connectionPort.list.mockResolvedValue(undefined as unknown as Connection[]);
      const task: SchedulerTaskConfig = {
        taskId: 'platform-undefined',
        platformType: 'allegro',
        jobType: 'marketplace.orders.poll',
        cronExpression: '*/5 * * * *',
        generatePayload: () => ({ schemaVersion: 1 }),
        generateIdempotencyKey: (c, t) => `${c.id}:${t}`,
      };

      await expect(
        (
          service as unknown as { executeTask: (t: SchedulerTaskConfig) => Promise<void> }
        ).executeTask(task)
      ).resolves.not.toThrow();

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });
  });

  describe('regulatory-status reconcile task (#1121)', () => {
    const defaultConfigGet = (key: string, defaultValue?: unknown): unknown => {
      const cronKeys = [
        'OL_INVENTORY_SYNC_CRON',
        'OL_PRODUCT_SYNC_CRON',
        'OL_PICKUP_POINT_REFRESH_CRON',
        'OL_REGULATORY_RECONCILE_CRON',
      ];
      if (cronKeys.includes(key)) return defaultValue ?? '*/15 * * * *';
      return 'true';
    };

    const getRegisteredTask = (): SchedulerTaskConfig | undefined =>
      (service as unknown as { tasks: SchedulerTaskConfig[] }).tasks.find(
        (t) => t.taskId === 'regulatory-status-reconcile'
      );

    it('registers a regulatory-status-reconcile task on onApplicationBootstrap (like the other three core tasks)', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.onApplicationBootstrap();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('regulatory-status-reconcile');
    });

    it('the task is capability-scoped to Invoicing via listCapabilityAdapters({ capability: "Invoicing" })', async () => {
      configService.get.mockImplementation(defaultConfigGet);
      const conn = createConnection('conn-inv-1');
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        { connectionId: 'conn-inv-1', connection: conn, adapter: {} as never, metadata: {} as never },
      ]);

      service.onApplicationBootstrap();
      const task = getRegisteredTask();
      expect(task?.connectionFilter).toBeDefined();

      const connections = await task!.connectionFilter!();

      expect(integrationsService.listCapabilityAdapters).toHaveBeenCalledWith({
        capability: 'Invoicing',
        lazy: true,
      });
      expect(connections).toEqual([conn]);
      expect(task?.platformType).toBeUndefined();
    });

    it('uses jobType invoicing.regulatoryStatus.reconcile and a payload with schemaVersion + limit', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.onApplicationBootstrap();
      const task = getRegisteredTask();

      expect(task?.jobType).toBe('invoicing.regulatoryStatus.reconcile');
      const payload = task!.generatePayload(createConnection('conn-inv-1'));
      expect(payload).toEqual({ schemaVersion: 1, limit: 100 });
    });

    it('does not register the task when OL_REGULATORY_RECONCILE_ENABLED is "false"', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_REGULATORY_RECONCILE_ENABLED') return 'false';
        return defaultConfigGet(key, defaultValue);
      });

      service.onApplicationBootstrap();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('regulatory-status-reconcile');
    });

    it('generates a minute-rounded per-connection idempotency key', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.onApplicationBootstrap();
      const task = getRegisteredTask();

      const key = task!.generateIdempotencyKey(createConnection('conn-inv-1'), '2026-06-05-03-30');
      expect(key).toBe('invoicing:conn-inv-1:regulatoryStatus:reconcile:2026-06-05-03-30');
    });
  });
});
