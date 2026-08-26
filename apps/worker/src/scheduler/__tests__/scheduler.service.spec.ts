/**
 * Scheduler Service Tests
 *
 * Unit tests for SchedulerService. Covers the core capability-based tasks
 * (inventory + product), the registry-drain path that picks up
 * plugin-contributed tasks (#584), executeTask scope routing, and teardown.
 *
 * Since #2279 the service lives in the worker and is driven by
 * `SchedulerLeaseCoordinator` through the idempotent `start()`/`stop()` pair
 * rather than self-starting on `onApplicationBootstrap`.
 *
 * @module apps/worker/src/scheduler/__tests__
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
  let registeredCronJobs: Map<string, { stop: () => void }>;

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

    // The registry mock is STATEFUL on purpose (#2279): `scheduleTask` creates
    // and starts a real `CronJob`, whose timer is only ever cleared by
    // `stop()` walking `getCronJobs()`. A stub returning a fixed empty Map
    // therefore leaks a live timer per registered task per test — harmless
    // under `apps/api`'s `forceExit: true`, but this spec now runs under
    // `apps/worker`'s config, which has none, so the leak hangs the suite.
    registeredCronJobs = new Map<string, { stop: () => void }>();
    schedulerRegistry = {
      addCronJob: jest.fn((name: string, job: { stop: () => void }) => {
        registeredCronJobs.set(name, job);
      }),
      getCronJobs: jest.fn(() => registeredCronJobs),
      deleteCronJob: jest.fn((name: string) => registeredCronJobs.delete(name)),
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

  afterEach(() => {
    // Stop every CronJob this test started (see the stateful registry mock).
    service.stop();
  });

  describe('start', () => {
    const defaultConfigGet = (key: string, defaultValue?: unknown): unknown => {
      const cronKeys = [
        // Kept ALPHABETICAL. A cron key missing from this list falls through to
        // `'true'` below, which CronJob rejects ("Unknown alias: tru") and which
        // aborts start() for EVERY task - so a new scheduled task
        // must register its cron key here, in order.
        'OL_INVENTORY_PROVENANCE_BACKFILL_CRON',
        'OL_INVENTORY_SYNC_CRON',
        'OL_MASTER_PRODUCT_DELTA_SYNC_CRON',
        'OL_MASTER_PRODUCT_RECONCILE_CRON',
        'OL_OFFLINE_RESUBMIT_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_ORDER_FX_STAMP_SWEEP_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_PENDING_RECOVERY_CRON',
        'OL_PICKUP_POINT_REFRESH_CRON',
        'OL_PRODUCT_SYNC_CRON',
        'OL_REGULATORY_RECONCILE_CRON',
        'OL_RETURNS_ORPHAN_RECONCILE_CRON',
        'OL_STALE_OFFER_PAUSE_CRON',
        'OL_TAXONOMY_SYNC_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_ORDER_FX_STAMP_SWEEP_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
      ];
      if (cronKeys.includes(key)) return defaultValue ?? '*/15 * * * *';
      return 'true';
    };

    it('should register the core inventory sync task when enabled', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('master-inventory-sync');
    });

    it('is idempotent — a second start does not re-register the same tasks (#2279 lease re-acquire)', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.start();
      const afterFirst = schedulerRegistry.addCronJob.mock.calls.length;
      service.start();

      expect(schedulerRegistry.addCronJob.mock.calls.length).toBe(afterFirst);
    });

    it('unwinds the started latch when scheduling throws, so a later start can recover (#2279)', () => {
      // A malformed cron expression — plugin env vars feed these verbatim, so
      // this is an operator typo, not a hypothetical.
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_INVENTORY_SYNC_CRON') return 'not-a-cron';
        return defaultConfigGet(key, defaultValue);
      });

      expect(() => service.start()).toThrow();

      // Leaving the latch set would make every later start() a silent no-op,
      // pinning this process as a half-scheduled holder of the lease forever.
      configService.get.mockImplementation(defaultConfigGet);
      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('master-inventory-sync');

      service.stop();
    });

    it('should not register the core inventory sync task when disabled', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_INVENTORY_SYNC_ENABLED') return 'false';
        return defaultConfigGet(key, defaultValue);
      });

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('master-inventory-sync');
    });

    it('should register the core product sync task when enabled', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('master-product-sync');
    });

    it('should not register the core product sync task when disabled', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_PRODUCT_SYNC_ENABLED') return 'false';
        return defaultConfigGet(key, defaultValue);
      });

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('master-product-sync');
    });

    it('should NOT register the product delta sync task by default (#2220 is opt-in)', () => {
      // It is additive work on top of the unchanged full sweep, and only a master
      // declaring the modified-since rung does anything with it. #2222 owns the
      // two-cadence policy that would make it the default.
      //
      // The env var must fall through to the DESCRIPTOR's default ('false'), which
      // is what an unset variable does in production. `defaultConfigGet` answers
      // `'true'` for every non-cron key, so using it alone would assert the
      // opposite of the intended condition.
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_MASTER_PRODUCT_DELTA_SYNC_ENABLED') return defaultValue;
        return defaultConfigGet(key, defaultValue);
      });

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('master-product-delta-sync');
    });

    it('should register the product delta sync task when explicitly enabled', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_MASTER_PRODUCT_DELTA_SYNC_ENABLED') return 'true';
        return defaultConfigGet(key, defaultValue);
      });

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('master-product-delta-sync');
    });

    it('should schedule plugin-contributed tasks drained from the registry', () => {
      configService.get.mockImplementation(defaultConfigGet);
      schedulerTaskRegistry.register(makeTask('plugin-orders-poll'));
      schedulerTaskRegistry.register(
        makeTask('plugin-offers-sync', { cronExpression: '*/30 * * * *' })
      );

      service.start();

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

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs.sort()).toEqual([
        // Capability-scoped like the rest — it drains OfferManager /
        // ProductPublisher connections and names no platform (#1979).
        'destination-taxonomy-sync',
        // Also core-owned and platform-free, and the most so of any task here:
        // it has neither a platform nor a capability, because its subject is a
        // predicate over one OL table (#2317).
        'inventory-provenance-backfill',
        'master-inventory-sync',
        'master-product-delta-sync',
        'master-product-reconcile',
        'master-product-sync',
        'offline-resubmit',
        'order-fx-stamp-sweep',
        'orders-tax-rate-backfill',
        'pending-recovery',
        'pickup-point-refresh',
        'regulatory-status-reconcile',
        // #2346 — global scope like the provenance backfill: reservations key on
        // (order, line, position) and carry no connection axis, so the task names
        // no platform either.
        'reservation-consume-sweep',
      'reservation-expiry-sweep',
        'returns-orphan-reconcile',
        'stale-offer-pause-sweep',
      ]);
    });

    it('should NOT register the offline-resubmit task by default - it is opt-in (#1585 B1)', () => {
      // Honour the descriptor default when the env var is unset (defaultConfigGet
      // otherwise hardcodes 'true' for every enable key).
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_OFFLINE_RESUBMIT_ENABLED') return defaultValue;
        return defaultConfigGet(key, defaultValue);
      });

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('offline-resubmit');
      // The always-on invoicing sweeps still register.
      expect(registeredJobs).toContain('pending-recovery');
      expect(registeredJobs).toContain('regulatory-status-reconcile');
    });

    it('should register the offline-resubmit task when explicitly enabled (#1585 B1)', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_OFFLINE_RESUBMIT_ENABLED') return 'true';
        return defaultConfigGet(key, defaultValue);
      });

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('offline-resubmit');
    });

    it('should skip a registry-contributed task whose enabledEnvVar resolves to false', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_PLUGIN_TASK_ENABLED') return 'false';
        return defaultConfigGet(key, defaultValue);
      });
      schedulerTaskRegistry.register(
        makeTask('gated-plugin-task', { enabledEnvVar: 'OL_PLUGIN_TASK_ENABLED' })
      );

      service.start();

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
        // Kept ALPHABETICAL. A cron key missing from this list falls through to
        // `'true'` below, which CronJob rejects ("Unknown alias: tru") and which
        // aborts start() for EVERY task - so a new scheduled task
        // must register its cron key here, in order.
        'OL_INVENTORY_PROVENANCE_BACKFILL_CRON',
        'OL_INVENTORY_SYNC_CRON',
        'OL_MASTER_PRODUCT_DELTA_SYNC_CRON',
        'OL_MASTER_PRODUCT_RECONCILE_CRON',
        'OL_OFFLINE_RESUBMIT_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_ORDER_FX_STAMP_SWEEP_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_PENDING_RECOVERY_CRON',
        'OL_PICKUP_POINT_REFRESH_CRON',
        'OL_PRODUCT_SYNC_CRON',
        'OL_REGULATORY_RECONCILE_CRON',
        'OL_RETURNS_ORPHAN_RECONCILE_CRON',
        'OL_STALE_OFFER_PAUSE_CRON',
        'OL_TAXONOMY_SYNC_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_ORDER_FX_STAMP_SWEEP_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
      ];
      if (cronKeys.includes(key)) return defaultValue ?? '*/15 * * * *';
      return 'true';
    };

    const getRegisteredTask = (): SchedulerTaskConfig | undefined =>
      (service as unknown as { tasks: SchedulerTaskConfig[] }).tasks.find(
        (t) => t.taskId === 'regulatory-status-reconcile'
      );

    it('registers a regulatory-status-reconcile task on start (like the other three core tasks)', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('regulatory-status-reconcile');
    });

    it('the task is capability-scoped to Invoicing via listCapabilityAdapters({ capability: "Invoicing" })', async () => {
      configService.get.mockImplementation(defaultConfigGet);
      const conn = createConnection('conn-inv-1');
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        { connectionId: 'conn-inv-1', connection: conn, adapter: {} as never, metadata: {} as never },
      ]);

      service.start();
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

      service.start();
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

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('regulatory-status-reconcile');
    });

    it('generates a minute-rounded per-connection idempotency key', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.start();
      const task = getRegisteredTask();

      const key = task!.generateIdempotencyKey(createConnection('conn-inv-1'), '2026-06-05-03-30');
      expect(key).toBe('invoicing:conn-inv-1:regulatoryStatus:reconcile:2026-06-05-03-30');
    });
  });

  describe('stale-offer-pause-sweep task (#1689)', () => {
    const defaultConfigGet = (key: string, defaultValue?: unknown): unknown => {
      const cronKeys = [
        // Kept ALPHABETICAL. A cron key missing from this list falls through to
        // `'true'` below, which CronJob rejects ("Unknown alias: tru") and which
        // aborts start() for EVERY task - so a new scheduled task
        // must register its cron key here, in order.
        'OL_INVENTORY_PROVENANCE_BACKFILL_CRON',
        'OL_INVENTORY_SYNC_CRON',
        'OL_MASTER_PRODUCT_DELTA_SYNC_CRON',
        'OL_MASTER_PRODUCT_RECONCILE_CRON',
        'OL_OFFLINE_RESUBMIT_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_ORDER_FX_STAMP_SWEEP_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_PENDING_RECOVERY_CRON',
        'OL_PICKUP_POINT_REFRESH_CRON',
        'OL_PRODUCT_SYNC_CRON',
        'OL_REGULATORY_RECONCILE_CRON',
        'OL_RETURNS_ORPHAN_RECONCILE_CRON',
        'OL_STALE_OFFER_PAUSE_CRON',
        'OL_TAXONOMY_SYNC_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_ORDER_FX_STAMP_SWEEP_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
      ];
      if (cronKeys.includes(key)) return defaultValue ?? '*/15 * * * *';
      return 'true';
    };

    const getRegisteredTask = (): SchedulerTaskConfig | undefined =>
      (service as unknown as { tasks: SchedulerTaskConfig[] }).tasks.find(
        (t) => t.taskId === 'stale-offer-pause-sweep'
      );

    it('registers the task by default (opt-out, not opt-in — unlike offline-resubmit)', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('stale-offer-pause-sweep');
    });

    it('is capability-scoped to OfferManager', async () => {
      configService.get.mockImplementation(defaultConfigGet);
      const conn = createConnection('conn-offer-1');
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        { connectionId: 'conn-offer-1', connection: conn, adapter: {} as never, metadata: {} as never },
      ]);

      service.start();
      const task = getRegisteredTask();
      const connections = await task!.connectionFilter!();

      expect(integrationsService.listCapabilityAdapters).toHaveBeenCalledWith({
        capability: 'OfferManager',
        lazy: true,
      });
      expect(connections).toEqual([conn]);
    });

    it('uses jobType marketplace.offer.pauseStaleSweep and a payload with schemaVersion + limit', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.start();
      const task = getRegisteredTask();

      expect(task?.jobType).toBe('marketplace.offer.pauseStaleSweep');
      const payload = task!.generatePayload(createConnection('conn-offer-1'));
      expect(payload).toEqual({ schemaVersion: 1, limit: 200 });
    });

    it('does not register the task when OL_STALE_OFFER_PAUSE_ENABLED is "false"', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_STALE_OFFER_PAUSE_ENABLED') return 'false';
        return defaultConfigGet(key, defaultValue);
      });

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('stale-offer-pause-sweep');
    });

    it('generates a minute-rounded per-connection idempotency key', () => {
      configService.get.mockImplementation(defaultConfigGet);

      service.start();
      const task = getRegisteredTask();

      const key = task!.generateIdempotencyKey(createConnection('conn-offer-1'), '2026-07-27-17-00');
      expect(key).toBe('marketplace:conn-offer-1:offer:pauseStaleSweep:2026-07-27-17-00');
    });
  });

  describe('destination-taxonomy-sync task (#1979, ADR-037)', () => {
    const defaultConfigGet = (key: string, defaultValue?: unknown): unknown => {
      const cronKeys = [
        // Kept ALPHABETICAL. A cron key missing from this list falls through to
        // `'true'` below, which CronJob rejects ("Unknown alias: tru") and which
        // aborts start() for EVERY task - so a new scheduled task
        // must register its cron key here, in order.
        'OL_INVENTORY_PROVENANCE_BACKFILL_CRON',
        'OL_INVENTORY_SYNC_CRON',
        'OL_MASTER_PRODUCT_DELTA_SYNC_CRON',
        'OL_MASTER_PRODUCT_RECONCILE_CRON',
        'OL_OFFLINE_RESUBMIT_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_ORDER_FX_STAMP_SWEEP_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_PENDING_RECOVERY_CRON',
        'OL_PICKUP_POINT_REFRESH_CRON',
        'OL_PRODUCT_SYNC_CRON',
        'OL_REGULATORY_RECONCILE_CRON',
        'OL_RETURNS_ORPHAN_RECONCILE_CRON',
        'OL_STALE_OFFER_PAUSE_CRON',
        'OL_TAXONOMY_SYNC_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_ORDER_FX_STAMP_SWEEP_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
      ];
      if (cronKeys.includes(key)) return defaultValue ?? '*/15 * * * *';
      return 'true';
    };

    const getRegisteredTask = (): SchedulerTaskConfig | undefined =>
      (service as unknown as { tasks: SchedulerTaskConfig[] }).tasks.find(
        (t) => t.taskId === 'destination-taxonomy-sync'
      );

    /**
     * An adapter that browses its own marketplace taxonomy AND declares which
     * tree that is. Since #2063 the declaration is what resolves the owner —
     * browsing alone says nothing about identity.
     */
    const owningAdapter = {
      fetchCategories: jest.fn(),
      getTaxonomyIdentity: (): string => 'allegro',
    };
    /** Browses, but names no tree — resolves to `null` and is skipped. */
    const undeclaredAdapter = { fetchCategories: jest.fn() };
    /** An adapter that borrows another owner's taxonomy (Erli -> allegro). */
    const borrowingAdapter = { getBorrowedTaxonomy: (): string => 'allegro' };

    beforeEach(() => {
      configService.get.mockImplementation(defaultConfigGet);
    });

    it('registers the task by default', () => {
      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('destination-taxonomy-sync');
    });

    it('does not register the task when OL_TAXONOMY_SYNC_ENABLED is "false"', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_TAXONOMY_SYNC_ENABLED') return 'false';
        return defaultConfigGet(key, defaultValue);
      });

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('destination-taxonomy-sync');
    });

    it('elects ONE connection per taxonomy owner so a shared tree is not synced twice', async () => {
      // The whole point of owner-keying: two Allegro connections share one tree.
      const first = createConnection('conn-a', 'allegro');
      const second = createConnection('conn-b', 'allegro');
      integrationsService.listCapabilityAdapters.mockImplementation(
        ({ capability }: { capability: string }) =>
          Promise.resolve(
            capability === 'OfferManager'
              ? [
                  { connectionId: 'conn-a', connection: first, adapter: {} as never, metadata: {} as never },
                  { connectionId: 'conn-b', connection: second, adapter: {} as never, metadata: {} as never },
                ]
              : []
          ) as never
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue(owningAdapter as never);
      integrationsService.getAdapter.mockImplementation((connectionId: string) =>
        Promise.resolve({
          connection: createConnection(connectionId, 'allegro'),
          metadata: {} as never,
        })
      );

      service.start();
      const connections = await getRegisteredTask()!.connectionFilter!();

      expect(connections).toEqual([first]);
    });

    it('keeps every shop connection, since each shop authors its own tree', async () => {
      const shop = createConnection('conn-shop', 'woocommerce');
      integrationsService.listCapabilityAdapters.mockImplementation(
        ({ capability }: { capability: string }) =>
          Promise.resolve(
            capability === 'ProductPublisher'
              ? [{ connectionId: 'conn-shop', connection: shop, adapter: {} as never, metadata: {} as never }]
              : []
          ) as never
      );

      service.start();
      const task = getRegisteredTask()!;
      const connections = await task.connectionFilter!();

      expect(connections).toEqual([shop]);
      expect(task.generateIdempotencyKey(shop, '2026-07-27-17-00')).toBe(
        'taxonomy:connection:conn-shop:sync:2026-07-27-17-00'
      );
      expect(task.generatePayload(shop)).toEqual({ schemaVersion: 1, taxonomyOwner: null });
    });

    it('keys a marketplace run by OWNER, so two connections cannot produce two runs', async () => {
      const conn = createConnection('conn-a', 'allegro');
      integrationsService.listCapabilityAdapters.mockImplementation(
        ({ capability }: { capability: string }) =>
          Promise.resolve(
            capability === 'OfferManager'
              ? [{ connectionId: 'conn-a', connection: conn, adapter: {} as never, metadata: {} as never }]
              : []
          ) as never
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue(owningAdapter as never);
      integrationsService.getAdapter.mockResolvedValue({
        connection: conn,
        metadata: {} as never,
      } as never);

      service.start();
      const task = getRegisteredTask()!;
      await task.connectionFilter!();

      expect(task.generateIdempotencyKey(conn, '2026-07-27-17-00')).toBe(
        'taxonomy:owner:allegro:sync:2026-07-27-17-00'
      );
      expect(task.generatePayload(conn)).toEqual({ schemaVersion: 1, taxonomyOwner: 'allegro' });
    });

    it('elects a borrowing connection under the OWNER it borrows from', async () => {
      // An Erli-only operator still needs the Allegro tree (ADR-037).
      const erli = createConnection('conn-erli', 'erli');
      integrationsService.listCapabilityAdapters.mockImplementation(
        ({ capability }: { capability: string }) =>
          Promise.resolve(
            capability === 'OfferManager'
              ? [{ connectionId: 'conn-erli', connection: erli, adapter: {} as never, metadata: {} as never }]
              : []
          ) as never
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue(borrowingAdapter as never);
      // The shared resolver always resolves the connection (a borrower's owner
      // does not depend on platformType, but one code path serves both cases).
      integrationsService.getAdapter.mockResolvedValue({
        connection: erli,
        metadata: {} as never,
      } as never);

      service.start();
      const task = getRegisteredTask()!;
      const connections = await task.connectionFilter!();

      expect(connections).toEqual([erli]);
      expect(task.generateIdempotencyKey(erli, '2026-07-27-17-00')).toBe(
        'taxonomy:owner:allegro:sync:2026-07-27-17-00'
      );
    });

    it('skips a marketplace that browses but declares no taxonomy identity', async () => {
      const ebay = createConnection('conn-ebay', 'ebay');
      integrationsService.listCapabilityAdapters.mockImplementation(
        ({ capability }: { capability: string }) =>
          Promise.resolve(
            capability === 'OfferManager'
              ? [{ connectionId: 'conn-ebay', connection: ebay, adapter: {} as never, metadata: {} as never }]
              : []
          ) as never
      );
      integrationsService.getCapabilityAdapter.mockResolvedValue(undeclaredAdapter as never);
      integrationsService.getAdapter.mockResolvedValue({
        connection: ebay,
        metadata: {} as never,
      } as never);

      service.start();
      const connections = await getRegisteredTask()!.connectionFilter!();

      expect(connections).toEqual([]);
    });

    it('throws rather than emitting an undefined-owner key when the filter has not run', () => {
      // A silent miss would collapse EVERY owner's job onto one key and drop
      // all but one sync, so the failure must be loud.
      service.start();
      const task = getRegisteredTask()!;

      expect(() =>
        task.generateIdempotencyKey(createConnection('conn-unknown', 'allegro'), '2026-07-27-17-00')
      ).toThrow(/Taxonomy scope not resolved/);
    });
  });

  describe('inventory-provenance-backfill task (#2317, ADR-058 step ii)', () => {
    const defaultConfigGet = (key: string, defaultValue?: unknown): unknown => {
      // Same alphabetical list + fallthrough contract as the sibling blocks.
      const cronKeys = [
        'OL_INVENTORY_PROVENANCE_BACKFILL_CRON',
        'OL_INVENTORY_SYNC_CRON',
        'OL_MASTER_PRODUCT_DELTA_SYNC_CRON',
        'OL_MASTER_PRODUCT_RECONCILE_CRON',
        'OL_OFFLINE_RESUBMIT_CRON',
        'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
        'OL_ORDER_FX_STAMP_SWEEP_CRON',
        'OL_PENDING_RECOVERY_CRON',
        'OL_PICKUP_POINT_REFRESH_CRON',
        'OL_PRODUCT_SYNC_CRON',
        'OL_REGULATORY_RECONCILE_CRON',
        'OL_RETURNS_ORPHAN_RECONCILE_CRON',
        'OL_STALE_OFFER_PAUSE_CRON',
        'OL_TAXONOMY_SYNC_CRON',
      ];
      if (cronKeys.includes(key)) return defaultValue ?? '*/15 * * * *';
      return 'true';
    };

    const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';

    const getRegisteredTask = (): SchedulerTaskConfig | undefined =>
      (service as unknown as { tasks: SchedulerTaskConfig[] }).tasks.find(
        (t) => t.taskId === 'inventory-provenance-backfill'
      );

    beforeEach(() => {
      configService.get.mockImplementation(defaultConfigGet);
    });

    it('registers the task by DEFAULT', () => {
      // Default ON: no platform calls, bounded, idempotent, self-latching - and
      // until it drains, #2325 cannot run at all. Same rationale as
      // master.product.reconcile.
      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).toContain('inventory-provenance-backfill');
    });

    it('does not register when OL_INVENTORY_PROVENANCE_BACKFILL_ENABLED is "false"', () => {
      configService.get.mockImplementation((key: string, defaultValue?: unknown) => {
        if (key === 'OL_INVENTORY_PROVENANCE_BACKFILL_ENABLED') return 'false';
        return defaultConfigGet(key, defaultValue);
      });

      service.start();

      const registeredJobs = schedulerRegistry.addCronJob.mock.calls.map((c) => c[0]);
      expect(registeredJobs).not.toContain('inventory-provenance-backfill');
    });

    it('runs ONCE for the deployment, under the system connection id', async () => {
      service.start();
      const connections = await getRegisteredTask()!.connectionFilter!();

      // The predicate `sourceConnectionId IS NULL` has no connection axis -
      // that absence is exactly what the pass repairs - so electing a real
      // connection would be wrong twice over: the installs with the most NULL
      // rows are those whose original connection was deleted, and a moving
      // election would move the completion latch.
      expect(connections).toHaveLength(1);
      expect(connections[0].id).toBe(SYSTEM_ID);
    });

    it('emits a schemaVersion-1 envelope with no connection-derived fields', () => {
      service.start();
      const task = getRegisteredTask()!;

      expect(task.generatePayload({ id: SYSTEM_ID } as never)).toEqual({
        schemaVersion: 1,
      });
    });

    it('mints a minute-stamped key carrying no connection id', () => {
      service.start();
      const task = getRegisteredTask()!;

      const key = task.generateIdempotencyKey(
        { id: SYSTEM_ID } as never,
        '2026-08-24-09-05'
      );
      // Deliberately not connection-scoped: there is one pass per deployment,
      // and a connection segment would falsely imply otherwise.
      expect(key).toBe('inventory:provenance:backfill:2026-08-24-09-05');
    });

    it('declares the job type the worker registers a handler for', () => {
      service.start();
      expect(getRegisteredTask()!.jobType).toBe('inventory.provenance.backfill');
    });
  });
});
