/**
 * Scheduler Service
 *
 * Generic scheduled service that periodically enqueues sync jobs
 * for multiple platforms and job types. Supports configurable cron schedules
 * and platform-specific job payload generation.
 *
 * @module apps/api/src/sync/application/services
 */
import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import { ConnectionPort, CONNECTION_PORT_TOKEN, Connection } from '@openlinker/core/identifier-mapping';
import { JobEnqueuePort, JOB_ENQUEUE_TOKEN, SyncJobRequest, JobType } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

/**
 * Scheduler Task Configuration
 *
 * Defines a scheduled task that enqueues jobs for a specific platform and job type.
 */
export interface SchedulerTaskConfig {
  /**
   * Unique task identifier (used for cron job name and logging)
   */
  taskId: string;

  /**
   * Platform type to filter connections (e.g., 'allegro', 'prestashop')
   */
  platformType: string;

  /**
   * Job type to enqueue (e.g., 'allegro.orders.poll')
   */
  jobType: JobType;

  /**
   * Cron expression for scheduling
   * Example: "*\/5 * * * *" for every 5 minutes
   */
  cronExpression: string;

  /**
   * Environment variable name to enable/disable this task (default: true)
   * Example: 'ALLEGRO_POLL_SCHEDULER_ENABLED'
   */
  enabledEnvVar?: string;

  /**
   * Generate job payload for a connection
   *
   * @param connection - The connection to generate payload for
   * @returns Job payload object
   */
  generatePayload: (connection: Connection) => Record<string, unknown>;

  /**
   * Generate idempotency key for a connection
   *
   * @param connection - The connection
   * @param timestamp - Current timestamp (YYYY-MM-DD-HH-MM format)
   * @returns Idempotency key string
   */
  generateIdempotencyKey: (connection: Connection, timestamp: string) => string;
}

@Injectable()
export class SchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly tasks: SchedulerTaskConfig[] = [];

  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    // Register default tasks (adds to this.tasks)
    this.registerDefaultTasks();

    // Register all configured tasks (schedules cron jobs)
    this.tasks.forEach((task) => this.scheduleTask(task));
  }

  /**
   * Register a scheduler task
   *
   * Adds a task configuration that will be scheduled on module init.
   * Can be called before or during module initialization.
   */
  registerTask(config: SchedulerTaskConfig): void {
    this.tasks.push(config);
  }

  /**
   * Register default scheduler tasks
   *
   * Registers platform-specific tasks based on environment configuration.
   * Can be overridden or extended by calling registerTask().
   */
  private registerDefaultTasks(): void {
    // Marketplace orders poll task (for Allegro connections)
    const allegroPollEnabled = this.configService.get<string>(
      'ALLEGRO_POLL_SCHEDULER_ENABLED',
      'true',
    );
    if (allegroPollEnabled !== 'false') {
      const allegroCronExpression = this.configService.get<string>(
        'ALLEGRO_POLL_INTERVAL_CRON',
        '*/5 * * * *', // Every 5 minutes
      );

      this.registerTask({
        taskId: 'allegro-orders-poll',
        platformType: 'allegro',
        jobType: 'marketplace.orders.poll',
        cronExpression: allegroCronExpression,
        enabledEnvVar: 'ALLEGRO_POLL_SCHEDULER_ENABLED',
        generatePayload: () => ({
          schemaVersion: 1,
          cursorKey: 'allegro.orders.lastEventId',
          limit: 100,
        }),
        generateIdempotencyKey: (connection, timestamp) =>
          `marketplace:${connection.id}:orders:poll:${timestamp}`,
      });
    }

    // Marketplace offers sync task (for Allegro connections)
    const allegroOffersSyncEnabled = this.configService.get<string>(
      'ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED',
      'true',
    );
    if (allegroOffersSyncEnabled !== 'false') {
      const offersCronExpression = this.configService.get<string>(
        'ALLEGRO_OFFERS_SYNC_INTERVAL_CRON',
        '*/30 * * * *', // Every 30 minutes
      );
      const pageLimit = Number(
        this.configService.get<string>('ALLEGRO_OFFERS_SYNC_PAGE_LIMIT', '100'),
      );
      const offersFeedTypeRaw = this.configService
        .get<string>('ALLEGRO_OFFERS_SYNC_FEED_TYPE', 'events')
        .toLowerCase();
      const offersFeedType = offersFeedTypeRaw === 'offers' ? 'offers' : 'events';

      this.registerTask({
        taskId: 'allegro-offers-sync',
        platformType: 'allegro',
        jobType: 'marketplace.offers.sync',
        cronExpression: offersCronExpression,
        enabledEnvVar: 'ALLEGRO_OFFERS_SYNC_SCHEDULER_ENABLED',
        generatePayload: (connection) => ({
          schemaVersion: 1,
          limit: Number.isFinite(pageLimit) && pageLimit > 0 ? pageLimit : 100,
          cursor: null,
          cursorKey: offersFeedType === 'events' ? 'allegro.offers.lastEventId' : undefined,
          feedType: offersFeedType,
          masterConnectionId: this.getMasterCatalogConnectionId(connection),
        }),
        generateIdempotencyKey: (connection, timestamp) =>
          `marketplace:${connection.id}:offers:sync:${timestamp}`,
      });
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
      `Registered scheduler task: ${task.taskId} (platform: ${task.platformType}, jobType: ${task.jobType}, cron: ${task.cronExpression})`,
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

    try {
      // Get all active connections for this platform
      const connections = await this.connectionPort.list({
        platformType: task.platformType,
        status: 'active',
      });

      if (connections.length === 0) {
        this.logger.debug(
          `No active ${task.platformType} connections found for task ${task.taskId}, skipping`,
        );
        return;
      }

      this.logger.log(
        `Found ${connections.length} active ${task.platformType} connection(s) for task ${task.taskId}, enqueuing jobs`,
      );

      // Enqueue job for each connection
      const enqueuePromises = connections.map((connection) =>
        this.enqueueJobForConnection(task, connection),
      );

      const results = await Promise.allSettled(enqueuePromises);

      // Log results
      const succeeded = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.filter((r) => r.status === 'rejected').length;

      if (failed > 0) {
        this.logger.warn(
          `Scheduler task ${task.taskId} completed with errors: ${succeeded} succeeded, ${failed} failed`,
        );
        // Log individual failures
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            this.logger.error(
              `Failed to enqueue job for connection ${connections[index].id} in task ${task.taskId}: ${result.reason}`,
            );
          }
        });
      } else {
        this.logger.log(
          `Scheduler task ${task.taskId} completed successfully: ${succeeded} job(s) enqueued`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Scheduler task ${task.taskId} failed`,
        error instanceof Error ? error.stack : String(error),
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
    connection: Connection,
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
      `Enqueued job for connection ${connection.id} (${connection.name}) in task ${task.taskId}: ${jobId} (existing: ${String(isExisting)})`,
    );

    return jobId;
  }

  private getMasterCatalogConnectionId(connection: Connection): string | null {
    const config = connection.config as Record<string, unknown>;
    const masterConnectionId = config.masterCatalogConnectionId;
    return typeof masterConnectionId === 'string' ? masterConnectionId : null;
  }
}

