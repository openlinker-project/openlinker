/**
 * Scheduler Service
 *
 * Generic scheduled service that drains the platform-agnostic
 * `SchedulerTaskRegistryService` and the two capability-based core tasks
 * (`master-inventory-sync`, `master-product-sync`) at bootstrap, then
 * schedules each with `@nestjs/schedule`. Platform-specific tasks (Allegro
 * orders-poll, offers-sync, …) are contributed by integration modules at
 * `onModuleInit` and picked up here at `onApplicationBootstrap` — NestJS
 * guarantees the lifecycle order so every integration has registered
 * before this drains (#584).
 *
 * @module apps/api/src/sync/application/services
 */
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Injectable, Inject } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { ConnectionPort, CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import type { SyncJobRequest, SchedulerTaskConfig } from '@openlinker/core/sync';
import {
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  SchedulerTaskRegistryService,
  SCHEDULER_TASK_REGISTRY_TOKEN,
} from '@openlinker/core/sync';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly tasks: SchedulerTaskConfig[] = [];

  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    @Inject(SCHEDULER_TASK_REGISTRY_TOKEN)
    private readonly schedulerTaskRegistry: SchedulerTaskRegistryService
  ) {}

  onApplicationBootstrap(): void {
    // Register the two capability-based core tasks (cross-platform — drain
    // every connection that supports a given capability). These stay
    // core-side; only platform-specific *triggers* move to integrations.
    this.registerInventorySyncTask();
    this.registerProductSyncTask();

    // Drain plugin-contributed tasks. Integration modules have already
    // populated the registry at `onModuleInit`; NestJS guarantees every
    // `onModuleInit` hook fires before any `onApplicationBootstrap`, so
    // the registry is fully populated by the time we read it here.
    for (const task of this.schedulerTaskRegistry.getAll()) {
      this.tasks.push(task);
    }

    // Schedule everything.
    this.tasks.forEach((task) => this.scheduleTask(task));
  }

  onModuleDestroy(): void {
    // Stop all registered cron jobs so the Node.js event loop can drain cleanly.
    // This is required for graceful shutdown in production and for integration
    // tests where app.close() is called — without this, active CronJob timers
    // keep the process alive indefinitely.
    // Snapshot entries before iterating — deleteCronJob mutates the internal Map
    // that getCronJobs() returns a reference to, which is fragile to modify mid-loop.
    const entries = [...this.schedulerRegistry.getCronJobs().entries()];
    for (const [name, job] of entries) {
      try {
        job.stop();
        this.schedulerRegistry.deleteCronJob(name);
        this.logger.debug(`Stopped scheduler task: ${name}`);
      } catch {
        // Ignore errors during teardown — the process is shutting down anyway
      }
    }
  }

  /**
   * Schedule a cron job for a scheduler task
   *
   * Creates and schedules a cron job that will enqueue sync jobs for all
   * active connections matching the task's platform type.
   */
  private scheduleTask(task: SchedulerTaskConfig): void {
    // Check if task is enabled
    const enabled = task.enabledEnvVar
      ? this.configService.get<string>(task.enabledEnvVar, 'true') !== 'false'
      : true;

    if (!enabled) {
      this.logger.debug(`Scheduler task ${task.taskId} is disabled, skipping registration`);
      return;
    }

    // Create cron job
    const cronJob = new CronJob(task.cronExpression, async () => {
      await this.executeTask(task);
    });

    // Register with scheduler registry
    this.schedulerRegistry.addCronJob(task.taskId, cronJob);
    cronJob.start();

    this.logger.log(
      `Registered scheduler task: ${task.taskId} (scope: ${task.connectionFilter ? 'capability' : task.platformType ?? 'unknown'}, jobType: ${task.jobType}, cron: ${task.cronExpression})`
    );
  }

  /**
   * Execute a scheduler task
   *
   * Gets all active connections for the platform and enqueues jobs for each.
   */
  private async executeTask(task: SchedulerTaskConfig): Promise<void> {
    // Check if task is enabled (runtime check)
    const enabled = task.enabledEnvVar
      ? this.configService.get<string>(task.enabledEnvVar, 'true') !== 'false'
      : true;

    if (!enabled) {
      return;
    }

    this.logger.debug(`Executing scheduler task: ${task.taskId}`);

    const scope = task.connectionFilter ? 'capability' : task.platformType ?? 'unknown';

    try {
      // Get connections: use custom filter if provided, otherwise filter by platformType
      let connections: Connection[];
      if (task.connectionFilter) {
        const result = await task.connectionFilter();
        if (result == null) {
          this.logger.warn(
            `Scheduler task ${task.taskId}: connectionFilter returned nullish — coercing to []. Upstream port contract violation.`
          );
        }
        connections = result ?? [];
      } else if (task.platformType) {
        const result = await this.connectionPort.list({
          platformType: task.platformType,
          status: 'active',
        });
        if (result == null) {
          this.logger.warn(
            `Scheduler task ${task.taskId}: connectionPort.list returned nullish — coercing to []. Upstream port contract violation.`
          );
        }
        connections = result ?? [];
      } else {
        this.logger.error(
          `Scheduler task ${task.taskId} has neither platformType nor connectionFilter — skipping`
        );
        return;
      }

      if (connections.length === 0) {
        this.logger.debug(`No active ${scope} connections found for task ${task.taskId}, skipping`);
        return;
      }

      this.logger.log(
        `Found ${connections.length} active ${scope} connection(s) for task ${task.taskId}, enqueuing jobs`
      );

      // Enqueue job for each connection
      const enqueuePromises = connections.map((connection) =>
        this.enqueueJobForConnection(task, connection)
      );

      const results = await Promise.allSettled(enqueuePromises);

      // Log results
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      if (failed > 0) {
        this.logger.warn(
          `Scheduler task ${task.taskId} completed with errors: ${succeeded} succeeded, ${failed} failed`
        );
        // Log individual failures
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.logger.error(
              `Failed to enqueue job for connection ${connections[index].id} in task ${task.taskId}: ${result.reason}`
            );
          }
        });
      } else {
        this.logger.log(
          `Scheduler task ${task.taskId} completed successfully: ${succeeded} job(s) enqueued`
        );
      }
    } catch (error) {
      this.logger.error(
        `Scheduler task ${task.taskId} failed`,
        error instanceof Error ? error.stack : String(error)
      );
    }
  }

  /**
   * Enqueue a job for a specific connection
   *
   * Generates the job request with payload and idempotency key, then enqueues it.
   */
  private async enqueueJobForConnection(
    task: SchedulerTaskConfig,
    connection: Connection
  ): Promise<string> {
    // Generate timestamp for idempotency key (rounded to the minute)
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;

    // Generate idempotency key
    const idempotencyKey = task.generateIdempotencyKey(connection, timestamp);

    // Generate payload
    const payload = task.generatePayload(connection);

    // Create job request
    const jobRequest: SyncJobRequest = {
      jobType: task.jobType,
      connectionId: connection.id,
      payload,
      idempotencyKey,
    };

    // Enqueue job
    const { jobId, isExisting } = await this.jobEnqueue.enqueueJob(jobRequest);

    this.logger.debug(
      `Enqueued job for connection ${connection.id} (${connection.name}) in task ${task.taskId}: ${jobId} (existing: ${String(isExisting)})`
    );

    return jobId;
  }

  /**
   * Register periodic inventory sync task.
   *
   * Enqueues master.inventory.syncAll jobs for all active connections
   * that support the InventoryMaster capability.
   */
  private registerInventorySyncTask(): void {
    const inventorySyncEnabled = this.configService.get<string>(
      'OL_INVENTORY_SYNC_ENABLED',
      'true'
    );
    if (inventorySyncEnabled === 'false') {
      return;
    }

    const inventoryCron = this.configService.get<string>('OL_INVENTORY_SYNC_CRON', '*/15 * * * *');

    this.tasks.push({
      taskId: 'master-inventory-sync',
      jobType: 'master.inventory.syncAll',
      cronExpression: inventoryCron,
      enabledEnvVar: 'OL_INVENTORY_SYNC_ENABLED',
      connectionFilter: async () => {
        const adapters = await this.integrationsService.listCapabilityAdapters({
          capability: 'InventoryMaster',
        });
        return (adapters ?? []).map((a) => a.connection);
      },
      generatePayload: () => ({
        schemaVersion: 1,
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `master:${connection.id}:inventory:syncAll:${timestamp}`,
    });
  }

  /**
   * Register periodic product catalog sync task.
   *
   * Enqueues master.product.syncAll jobs for all active connections that support
   * the ProductMaster capability. Handler enumerates source-platform products and
   * fans out per-product syncByExternalId sub-jobs — this is the catalog-discovery
   * path that populates identifier mappings on a fresh connection.
   */
  private registerProductSyncTask(): void {
    const productSyncEnabled = this.configService.get<string>('OL_PRODUCT_SYNC_ENABLED', 'true');
    if (productSyncEnabled === 'false') {
      return;
    }

    const productCron = this.configService.get<string>('OL_PRODUCT_SYNC_CRON', '*/20 * * * *');

    this.tasks.push({
      taskId: 'master-product-sync',
      jobType: 'master.product.syncAll',
      cronExpression: productCron,
      enabledEnvVar: 'OL_PRODUCT_SYNC_ENABLED',
      connectionFilter: async () => {
        const adapters = await this.integrationsService.listCapabilityAdapters({
          capability: 'ProductMaster',
        });
        return (adapters ?? []).map((a) => a.connection);
      },
      generatePayload: () => ({
        schemaVersion: 1,
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        `master:${connection.id}:product:syncAll:${timestamp}`,
    });
  }
}
