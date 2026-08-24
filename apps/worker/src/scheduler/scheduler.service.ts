/**
 * Scheduler Service
 *
 * Generic scheduled service that drains the platform-agnostic
 * `SchedulerTaskRegistryService` and the capability-based core tasks
 * (`CORE_CAPABILITY_TASKS`), then schedules each with `@nestjs/schedule`.
 * Platform-specific tasks (Allegro orders-poll, offers-sync, …) are
 * contributed by integration modules at `onModuleInit` and drained here on
 * `start()`, which runs no earlier than `onApplicationBootstrap` — NestJS
 * guarantees the lifecycle order so every integration has registered before
 * the drain (#584).
 *
 * Lives in the WORKER since #2279 (ADR-051): scheduling is background work,
 * and the api hosting it forced every api replica to be a scheduler. It no
 * longer self-starts — `SchedulerLeaseCoordinator` calls the idempotent
 * `start()`/`stop()` pair as its `singleton:scheduler` lease is won and lost,
 * so at most one process in the fleet ticks crons at a time.
 *
 * @module apps/worker/src/scheduler
 */
import type { OnModuleDestroy } from '@nestjs/common';
import { Injectable, Inject } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import type { Connection } from '@openlinker/core/identifier-mapping';
import { ConnectionPort, CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import type { SyncJobRequest, SchedulerTaskConfig, JobType } from '@openlinker/core/sync';
import {
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  SchedulerTaskRegistryService,
  SCHEDULER_TASK_REGISTRY_TOKEN,
} from '@openlinker/core/sync';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OfferManagerPort, TaxonomyOwner } from '@openlinker/core/listings';
import { resolveTaxonomyOwner } from '@openlinker/core/listings';
import { Logger } from '@openlinker/shared/logging';

/**
 * Default page size for the regulatory-status reconciliation fan-out payload
 * (#1121). The worker handler clamps a payload-supplied `limit` to MAX_LIMIT.
 */
const REGULATORY_RECONCILE_DEFAULT_LIMIT = 100;

/**
 * Default page size for the offline-resubmission sweep fan-out payload (#1702).
 * The worker handler clamps a payload-supplied `limit` to its own MAX_LIMIT.
 */
const OFFLINE_RESUBMIT_DEFAULT_LIMIT = 100;

/**
 * Default page size for the crash-recovery sweep fan-out payload (#1703). The
 * worker handler clamps a payload-supplied `limit` to its own MAX_LIMIT.
 */
const PENDING_RECOVERY_DEFAULT_LIMIT = 100;

/**
 * Default page size for the stale-offer-pause reconcile sweep (#1689). Bounds
 * the per-connection, per-tick query on `OfferMappingRepositoryPort.findStaleMappedVariants`.
 */
const STALE_OFFER_PAUSE_DEFAULT_LIMIT = 200;

/**
 * Default bounds for the order FX-stamp reconcile sweep (#2125). `limit` bounds
 * the per-connection page; `maxAgeDays` keeps the pre-feature backlog from
 * crowding out live orders on every tick. The worker handler clamps both.
 */
const ORDER_FX_STAMP_SWEEP_DEFAULT_LIMIT = 100;
const ORDER_FX_STAMP_SWEEP_DEFAULT_MAX_AGE_DAYS = 30;

/**
 * Default page size for the tax-rate backfill sweep (#2440). Bounds the
 * per-connection, per-tick scan of `IDX_order_line_items_no_tax_rate`.
 */
const ORDERS_TAX_RATE_BACKFILL_DEFAULT_LIMIT = 100;

/**
 * Static descriptor for a core capability-scoped scheduler task. The four core
 * tasks (inventory / product / pickup-point / regulatory-reconcile) are
 * structurally identical — drain every active connection supporting `capability`
 * and enqueue `jobType` — differing only in these literals. `registerCapabilityTask`
 * turns one descriptor into a `SchedulerTaskConfig` so the `connectionFilter`,
 * idempotency-key, and payload shapes are defined ONCE (#1206 cleanup).
 */
interface CoreCapabilityTaskDescriptor {
  /** Stable task id / cron-registry key. */
  readonly taskId: string;
  /** Sync job type enqueued per matching connection. */
  readonly jobType: JobType;
  /** Adapter/connection capability the task drains. */
  readonly capability: string;
  /** Env var that gates registration AND each run (`'false'` disables). */
  readonly enabledEnvVar: string;
  /**
   * Default enablement when `enabledEnvVar` is unset (defaults to `true`). Set
   * `false` for a task that must remain opt-in until an operator explicitly
   * enables it (#1585 B1 — the offline-resubmit sweep).
   */
  readonly defaultEnabled?: boolean;
  /** Env var holding the cron expression. */
  readonly cronEnvVar: string;
  /** Cron expression used when `cronEnvVar` is unset. */
  readonly defaultCron: string;
  /**
   * Builds the idempotency key for a (connection, minute-timestamp) pair.
   * Preserves each task's existing key namespace verbatim.
   */
  readonly idempotencyKey: (connectionId: string, timestamp: string) => string;
  /**
   * Optional extra payload fields merged onto the `{ schemaVersion: 1 }` base.
   * Only the regulatory-reconcile task carries one (`limit`).
   */
  readonly extraPayload?: Record<string, unknown>;
}

/**
 * The core capability tasks, in their existing registration order. Behaviour is
 * byte-for-byte the same as the former `register*Task` methods — same taskIds,
 * jobTypes, capabilities, env vars, default crons, key namespaces, and payloads.
 */
const CORE_CAPABILITY_TASKS: readonly CoreCapabilityTaskDescriptor[] = [
  {
    taskId: 'master-inventory-sync',
    jobType: 'master.inventory.syncAll',
    capability: 'InventoryMaster',
    enabledEnvVar: 'OL_INVENTORY_SYNC_ENABLED',
    cronEnvVar: 'OL_INVENTORY_SYNC_CRON',
    defaultCron: '*/15 * * * *',
    idempotencyKey: (connectionId, timestamp) =>
      `master:${connectionId}:inventory:syncAll:${timestamp}`,
  },
  {
    taskId: 'master-product-sync',
    jobType: 'master.product.syncAll',
    capability: 'ProductMaster',
    enabledEnvVar: 'OL_PRODUCT_SYNC_ENABLED',
    cronEnvVar: 'OL_PRODUCT_SYNC_CRON',
    defaultCron: '*/20 * * * *',
    idempotencyKey: (connectionId, timestamp) =>
      `master:${connectionId}:product:syncAll:${timestamp}`,
  },
  {
    // Incremental catalog pass (#2220, ADR-048). OPT-IN: it is additive work on top
    // of the unchanged 20-minute full sweep, and only a master declaring the
    // modified-since rung does anything with it. #2222 owns the two-cadence policy
    // that would make it the default and relax the full pass.
    //
    // Gated on `ProductMaster`, not on the rung's own name: a connection's
    // `enabledCapabilities` is stamped at create and never retro-filled, so gating
    // on a newly advertised capability would drain nothing for every connection
    // that already exists. The handler narrows with `isModifiedProductLister`.
    taskId: 'master-product-delta-sync',
    jobType: 'master.product.syncDelta',
    capability: 'ProductMaster',
    enabledEnvVar: 'OL_MASTER_PRODUCT_DELTA_SYNC_ENABLED',
    defaultEnabled: false,
    cronEnvVar: 'OL_MASTER_PRODUCT_DELTA_SYNC_CRON',
    // 15 min, derived from the same drain-rate rule `bounded-sweep.ts` states for
    // the budget: budget x per-child-duration must fit inside the tick. One child
    // is a full per-product platform sync (~2-5 s) against an execution
    // concurrency of 1 that `syncAll` and `master.inventory.syncAll` are already
    // feeding, so the default budget of 100 needs ~500 s worst case. A 5-minute
    // tick would be ~167% of that and would pile up during exactly the event this
    // pass exists for — a bulk catalog edit, when pages come back full.
    defaultCron: '*/15 * * * *',
    idempotencyKey: (connectionId, timestamp) =>
      `master:${connectionId}:product:syncDelta:${timestamp}`,
  },
  {
    // Deletion reconciliation (#2222, ADR-048 decision 2). Re-checks OL's own
    // product mappings by id so the adapter's 404 is the deletion authority —
    // the catalog sweep enumerates FROM the master and is structurally blind to
    // a deletion.
    //
    // Deliberately NOT gated to connections lacking InventoryMaster, even though
    // `master.inventory.syncAll` gives those the same detection for free: a
    // capability-shaped exclusion rots, and it would also skip the #1904 case
    // where the inventory path withholds its prune to a rival claimant. The
    // overlap is paid for with a slow cadence instead.
    //
    // Hourly, not 15-minutely: one platform call per mapped product per cycle is
    // the cost, and deletion-detection latency is the thing being traded. The
    // budget bounds each tick; the cycle spans as many ticks as it needs.
    taskId: 'master-product-reconcile',
    jobType: 'master.product.reconcile',
    capability: 'ProductMaster',
    enabledEnvVar: 'OL_MASTER_PRODUCT_RECONCILE_ENABLED',
    cronEnvVar: 'OL_MASTER_PRODUCT_RECONCILE_CRON',
    defaultCron: '0 * * * *',
    idempotencyKey: (connectionId, timestamp) =>
      `master:${connectionId}:product:reconcile:${timestamp}`,
  },
  {
    taskId: 'pickup-point-refresh',
    jobType: 'shipping.pickupPoint.refreshFrequent',
    capability: 'ShippingProviderManager',
    enabledEnvVar: 'OL_PICKUP_POINT_REFRESH_ENABLED',
    cronEnvVar: 'OL_PICKUP_POINT_REFRESH_CRON',
    defaultCron: '0 3 * * *',
    idempotencyKey: (connectionId, timestamp) =>
      `shipping:${connectionId}:pickupPoints:refresh:${timestamp}`,
  },
  {
    taskId: 'regulatory-status-reconcile',
    jobType: 'invoicing.regulatoryStatus.reconcile',
    capability: 'Invoicing',
    enabledEnvVar: 'OL_REGULATORY_RECONCILE_ENABLED',
    cronEnvVar: 'OL_REGULATORY_RECONCILE_CRON',
    defaultCron: '*/30 * * * *',
    idempotencyKey: (connectionId, timestamp) =>
      `invoicing:${connectionId}:regulatoryStatus:reconcile:${timestamp}`,
    extraPayload: { limit: REGULATORY_RECONCILE_DEFAULT_LIMIT },
  },
  {
    taskId: 'offline-resubmit',
    jobType: 'invoicing.offlineSubmission.resubmit',
    capability: 'Invoicing',
    enabledEnvVar: 'OL_OFFLINE_RESUBMIT_ENABLED',
    // Opt-in (#1585 B1): the sweep resubmits a locally-issued document once the
    // authority recovers, and its duplicate-issue guard relies on the provider's
    // record-locate wire contract. Until an operator has verified that contract
    // against their own authority, this stays OFF so a mis-parsed locate response
    // can never trigger an auto-resubmit that double-issues.
    defaultEnabled: false,
    cronEnvVar: 'OL_OFFLINE_RESUBMIT_CRON',
    defaultCron: '*/15 * * * *',
    idempotencyKey: (connectionId, timestamp) =>
      `invoicing:${connectionId}:offlineSubmission:resubmit:${timestamp}`,
    extraPayload: { limit: OFFLINE_RESUBMIT_DEFAULT_LIMIT },
  },
  {
    taskId: 'pending-recovery',
    jobType: 'invoicing.pendingRecovery.sweep',
    capability: 'Invoicing',
    enabledEnvVar: 'OL_PENDING_RECOVERY_ENABLED',
    cronEnvVar: 'OL_PENDING_RECOVERY_CRON',
    defaultCron: '*/20 * * * *',
    idempotencyKey: (connectionId, timestamp) =>
      `invoicing:${connectionId}:pendingRecovery:sweep:${timestamp}`,
    extraPayload: { limit: PENDING_RECOVERY_DEFAULT_LIMIT },
  },
  {
    taskId: 'stale-offer-pause-sweep',
    jobType: 'marketplace.offer.pauseStaleSweep',
    capability: 'OfferManager',
    enabledEnvVar: 'OL_STALE_OFFER_PAUSE_ENABLED',
    // Default ON (unlike offline-resubmit): the failure mode of running this is
    // a redundant absolute-set to 0 on an offer whose variant is genuinely
    // deleted; the failure mode of NOT running it is unbounded oversell (#1689).
    cronEnvVar: 'OL_STALE_OFFER_PAUSE_CRON',
    // Offset minute (17) so it doesn't pile onto the */15 and */20 master syncs.
    defaultCron: '17 * * * *',
    idempotencyKey: (connectionId, timestamp) =>
      `marketplace:${connectionId}:offer:pauseStaleSweep:${timestamp}`,
    extraPayload: { limit: STALE_OFFER_PAUSE_DEFAULT_LIMIT },
  },
  {
    taskId: 'order-fx-stamp-sweep',
    jobType: 'marketplace.order.fxStampSweep',
    // Scoped to `OrderSource` because `order_records.sourceConnectionId` is the
    // only connection axis an order row carries, and `SyncJob.connectionId` is
    // non-nullable — so the fan-out that already exists per source connection
    // is also the natural partition of the unstamped frontier. The stamp itself
    // is connection-agnostic.
    capability: 'OrderSource',
    enabledEnvVar: 'OL_ORDER_FX_STAMP_SWEEP_ENABLED',
    // Default ON, like the stale-offer sweep and for the same shape of reason:
    // running it re-attempts a stamp that is idempotent by construction, while
    // NOT running it means a provider outage longer than the ~4.3 h retry
    // window silently loses the figure forever (#2125).
    cronEnvVar: 'OL_ORDER_FX_STAMP_SWEEP_CRON',
    // Offset minute (23) so it doesn't pile onto the */15 and */20 master syncs
    // or the :17 stale-offer sweep.
    defaultCron: '23 * * * *',
    idempotencyKey: (connectionId, timestamp) =>
      `marketplace:${connectionId}:order:fxStampSweep:${timestamp}`,
    extraPayload: {
      limit: ORDER_FX_STAMP_SWEEP_DEFAULT_LIMIT,
      maxAgeDays: ORDER_FX_STAMP_SWEEP_DEFAULT_MAX_AGE_DAYS,
    },
  },
  {
    taskId: 'orders-tax-rate-backfill',
    jobType: 'orders.taxRate.backfill',
    // Same reasoning as `order-fx-stamp-sweep` immediately above: the rate
    // being backfilled is connection-agnostic, but `order_line_items.
    // sourceConnectionId` is the connection axis every row actually carries,
    // and `SyncJob.connectionId` is non-nullable — so the per-`OrderSource`-
    // connection fan-out is the natural partition of the rate-less frontier.
    capability: 'OrderSource',
    enabledEnvVar: 'OL_ORDERS_TAX_RATE_BACKFILL_ENABLED',
    // Default ON: every write is additively guarded (`WHERE taxRate IS NULL`)
    // and reads only the current catalogue state — there is no failure mode
    // where running it does harm, only one where NOT running it leaves
    // historical orders excluded from a net revenue figure indefinitely.
    cronEnvVar: 'OL_ORDERS_TAX_RATE_BACKFILL_CRON',
    // Offset minute (37) so it doesn't pile onto the other hourly sweeps
    // above (:17, :23).
    defaultCron: '37 * * * *',
    idempotencyKey: (connectionId, timestamp) =>
      `orders:${connectionId}:taxRate:backfill:${timestamp}`,
    extraPayload: { limit: ORDERS_TAX_RATE_BACKFILL_DEFAULT_LIMIT },
  },
];

@Injectable()
export class SchedulerService implements OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private tasks: SchedulerTaskConfig[] = [];
  private started = false;

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

  /**
   * Register + schedule every task. Idempotent — the lease coordinator may
   * call it again after a lost-and-rewon lease, and a second call while
   * started is a no-op. Must not run before `onApplicationBootstrap`: the
   * plugin task registry is populated at `onModuleInit`, and the lease
   * coordinator's first tick honours that ordering.
   */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.tasks = [];

    try {
      // Register the capability-based core tasks (cross-platform — drain every
      // connection that supports a given capability). These stay core-side; only
      // platform-specific *triggers* move to integrations. Each is a row in
      // CORE_CAPABILITY_TASKS — see registerCapabilityTask for the shared shape.
      for (const descriptor of CORE_CAPABILITY_TASKS) {
        this.registerCapabilityTask(descriptor);
      }

      // Registered bespoke rather than as a CORE_CAPABILITY_TASKS row (#1979).
      this.registerDestinationTaxonomyTask();

      // Drain plugin-contributed tasks — populated at `onModuleInit`, complete
      // by the time any post-bootstrap start() runs.
      for (const task of this.schedulerTaskRegistry.getAll()) {
        this.tasks.push(task);
      }

      // Schedule everything.
      this.tasks.forEach((task) => this.scheduleTask(task));
    } catch (error) {
      // A malformed cron expression (plugin env vars feed these verbatim)
      // makes `new CronJob` throw and aborts the whole loop. Unwinding the
      // latch is what keeps that recoverable: leaving `started = true` would
      // make every later start() a silent no-op, pinning the process as a
      // half-scheduled holder of the lease forever.
      this.started = false;
      try {
        this.stop();
      } catch (cleanupError) {
        // Never let cleanup mask the real diagnostic — the cron expression
        // that threw is what the operator needs to see.
        this.logger.warn(
          `Cleanup after a failed scheduler start also failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`
        );
      }
      throw error;
    }
  }

  /**
   * Stop and unregister every cron job. Idempotent; called on lease loss and
   * at shutdown. Also required so the Node.js event loop can drain cleanly —
   * without it, active CronJob timers keep the process alive indefinitely.
   */
  stop(): void {
    // Deliberately unconditional rather than guarded on `started`: clearing an
    // empty registry is a no-op, and a teardown that runs without a preceding
    // start must still leave nothing behind (a lease lost before the first
    // start, or a shutdown on a parked replica).
    this.started = false;
    // Snapshot entries before iterating — deleteCronJob mutates the internal Map
    // that getCronJobs() returns a reference to, which is fragile to modify mid-loop.
    const entries = [...this.schedulerRegistry.getCronJobs().entries()];
    for (const [name, job] of entries) {
      try {
        job.stop();
        this.schedulerRegistry.deleteCronJob(name);
        this.logger.debug(`Stopped scheduler task: ${name}`);
      } catch {
        // Ignore errors during teardown — the lease moved or the process is
        // shutting down anyway.
      }
    }
    this.tasks = [];
  }

  onModuleDestroy(): void {
    this.stop();
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
      ? this.configService.get<string>(
          task.enabledEnvVar,
          task.enabledDefault === false ? 'false' : 'true',
        ) !== 'false'
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
      ? this.configService.get<string>(
          task.enabledEnvVar,
          task.enabledDefault === false ? 'false' : 'true',
        ) !== 'false'
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
        if (task.requiredCapability) {
          connections = connections.filter((connection) =>
            connection.enabledCapabilities.includes(task.requiredCapability as string)
          );
        }
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
   * Register one core capability-scoped task from a static descriptor (#1206).
   *
   * Single data-driven replacement for the former four near-identical
   * `register*Task` methods (inventory / product / pickup-point /
   * regulatory-reconcile). Behaviour is preserved verbatim per descriptor:
   *  - registration is skipped when `enabledEnvVar` is literally `'false'`
   *    (default `'true'`) — the same registration-time gate the old methods had,
   *    on top of the per-run check in `scheduleTask`/`executeTask`;
   *  - `connectionFilter` drains every active connection whose adapter+operator
   *    enable `capability` (via `listCapabilityAdapters`, mapped to `.connection`),
   *    null-coerced to `[]` exactly as before;
   *  - the payload is `{ schemaVersion: 1, ...extraPayload }` (only reconcile
   *    adds `limit`);
   *  - the idempotency key uses the descriptor's per-task namespace builder.
   */
  private registerCapabilityTask(descriptor: CoreCapabilityTaskDescriptor): void {
    const enabledDefaultValue = descriptor.defaultEnabled === false ? 'false' : 'true';
    const enabled = this.configService.get<string>(
      descriptor.enabledEnvVar,
      enabledDefaultValue,
    );
    if (enabled === 'false') {
      return;
    }

    const cronExpression = this.configService.get<string>(
      descriptor.cronEnvVar,
      descriptor.defaultCron
    );

    this.tasks.push({
      taskId: descriptor.taskId,
      jobType: descriptor.jobType,
      cronExpression,
      enabledEnvVar: descriptor.enabledEnvVar,
      enabledDefault: descriptor.defaultEnabled,
      connectionFilter: async () => {
        // `lazy` (#1206): the fan-out needs only `.connection`; deferring adapter
        // construction avoids building (and credential-resolving) a live adapter
        // per active connection every tick just to discard it.
        const adapters = await this.integrationsService.listCapabilityAdapters({
          capability: descriptor.capability,
          lazy: true,
        });
        return (adapters ?? []).map((a) => a.connection);
      },
      generatePayload: () => ({
        schemaVersion: 1,
        ...descriptor.extraPayload,
      }),
      generateIdempotencyKey: (connection, timestamp) =>
        descriptor.idempotencyKey(connection.id, timestamp),
    });
  }

  /**
   * Register the destination-taxonomy refresh (#1979, ADR-037).
   *
   * This one cannot be a `CORE_CAPABILITY_TASKS` row: the dedup subject is the
   * taxonomy OWNER, but `CoreCapabilityTaskDescriptor.idempotencyKey` is
   * synchronous over a `connectionId`, and resolving a connection to its owner
   * needs an async adapter probe. Do not "tidy" this back into the loop — doing
   * so silently restores a per-connection fan-out that syncs one shared
   * marketplace tree once per connection.
   *
   * Two mechanisms, deliberately both: the filter ELECTS one connection per
   * owner (which is what actually prevents the fan-out), and the owner-scoped
   * idempotency key collapses same-minute duplicates (the ADR's stated
   * invariant).
   */
  private registerDestinationTaxonomyTask(): void {
    const enabled = this.configService.get<string>('OL_TAXONOMY_SYNC_ENABLED', 'true');
    if (enabled === 'false') {
      return;
    }

    const cronExpression = this.configService.get<string>(
      'OL_TAXONOMY_SYNC_CRON',
      // Offset minute, clear of the */15, */20, */30, :17 and 03:00 tasks.
      '23 * * * *'
    );

    // Resolved once per tick by `connectionFilter`, then read by the payload and
    // key builders. Those three callbacks are invoked separately by
    // `executeTask` -> `enqueueJobForConnection` with no ordering guarantee, so
    // a miss must be LOUD: an `undefined` owner inside the key would collapse
    // every owner's job onto one key and drop all but one sync.
    const scopeByConnectionId = new Map<string, TaxonomyOwner | null>();
    const requireScope = (connectionId: string): TaxonomyOwner | null => {
      if (!scopeByConnectionId.has(connectionId)) {
        throw new Error(
          `Taxonomy scope not resolved for connection ${connectionId} — connectionFilter must run first`
        );
      }
      return scopeByConnectionId.get(connectionId) ?? null;
    };

    this.tasks.push({
      taskId: 'destination-taxonomy-sync',
      jobType: 'destination.taxonomy.sync',
      cronExpression,
      enabledEnvVar: 'OL_TAXONOMY_SYNC_ENABLED',
      connectionFilter: async () => {
        scopeByConnectionId.clear();

        const marketplace = await this.integrationsService.listCapabilityAdapters<unknown>({
          capability: 'OfferManager',
          lazy: true,
        });
        const shops = await this.integrationsService.listCapabilityAdapters<unknown>({
          capability: 'ProductPublisher',
          lazy: true,
        });

        const elected: Connection[] = [];
        const electedOwners = new Set<string>();

        // Marketplaces: one shared tree per owner, so elect a single source
        // connection. Sorted by id first so the election is deterministic
        // across ticks rather than dependent on listing order.
        const marketplaceConnections = (marketplace ?? [])
          .map((entry) => entry.connection)
          .sort((a, b) => a.id.localeCompare(b.id));

        for (const connection of marketplaceConnections) {
          const owner = await this.resolveOwnerForElection(connection.id);
          if (owner === null || electedOwners.has(owner)) {
            continue;
          }
          electedOwners.add(owner);
          scopeByConnectionId.set(connection.id, owner);
          elected.push(connection);
        }

        // Shops author their own tree, so every shop connection syncs its own.
        for (const entry of shops ?? []) {
          if (scopeByConnectionId.has(entry.connection.id)) {
            continue;
          }
          scopeByConnectionId.set(entry.connection.id, null);
          elected.push(entry.connection);
        }

        return elected;
      },
      generatePayload: (connection) => ({
        schemaVersion: 1,
        taxonomyOwner: requireScope(connection.id),
      }),
      generateIdempotencyKey: (connection, timestamp) => {
        const owner = requireScope(connection.id);
        return owner !== null
          ? `taxonomy:owner:${owner}:sync:${timestamp}`
          : `taxonomy:connection:${connection.id}:sync:${timestamp}`;
      },
    });
  }

  /**
   * Resolve a marketplace connection to the taxonomy owner it reads, or `null`
   * when it declares no taxonomy identity. Capability-driven: a borrower names
   * the owner it reuses, an owner declares its own tree — never inferred from
   * `platformType`, which cannot express an axis a platform splits its tree
   * along (#2063).
   */
  private async resolveOwnerForElection(connectionId: string): Promise<TaxonomyOwner | null> {
    try {
      const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
        connectionId,
        'OfferManager'
      );

      // Shared with DestinationTaxonomyService so the election and the rows it
      // produces can never key on different owners.
      return resolveTaxonomyOwner(adapter);
    } catch (error) {
      // A connection mid-reauth or with failing credentials simply doesn't get
      // elected this tick; the next tick elects a different source.
      this.logger.debug(
        `Could not resolve taxonomy owner for connection ${connectionId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }
}
