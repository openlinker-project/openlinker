/**
 * Scheduler Task Config
 *
 * Public contract for a single scheduled cron task: identity, platform/
 * capability scope, cron expression, enable-gate, payload + idempotency-key
 * generators. Integration modules build instances of this type and register
 * them with `SchedulerTaskRegistryService` at bootstrap (#584); the
 * `SchedulerService` in `apps/api` drains the registry and schedules each
 * task with `@nestjs/schedule`.
 *
 * Moved out of `apps/api/src/sync/application/services/scheduler.service.ts`
 * so plugin integrations can value-import it via `@openlinker/core/sync`
 * (#584 / Thread E). No framework deps — pure interface plus lambdas.
 *
 * @module domain/types
 */
import type { Connection } from '../../../identifier-mapping/domain/entities/connection.entity';
import type { JobType } from './sync-job.types';

/**
 * Defines a scheduled task that enqueues jobs for a specific platform or
 * for every connection that supports a given capability.
 *
 * **Scope invariant**: exactly one of `platformType` or `connectionFilter`
 * must be set. The scheduler errors and skips the task at runtime if both
 * are absent. A future refactor could promote this into a discriminated
 * union; for now the invariant is documented here and enforced in
 * `SchedulerService.executeTask`.
 */
export interface SchedulerTaskConfig {
  /**
   * Unique task identifier. Used as the cron-job name in `SchedulerRegistry`
   * (must be unique across the whole process) and for log correlation.
   */
  taskId: string;

  /**
   * Platform type to filter connections (e.g., `'allegro'`, `'prestashop'`).
   *
   * **Required unless `connectionFilter` is set.** Mutually exclusive with
   * `connectionFilter` — when both are supplied, `connectionFilter` wins
   * and `platformType` is ignored.
   */
  platformType?: string;

  /**
   * Job type to enqueue (e.g., `'marketplace.orders.poll'`).
   */
  jobType: JobType;

  /**
   * Cron expression for scheduling. Example: `"*\/5 * * * *"` for every 5
   * minutes. Parsed by the `cron` package.
   */
  cronExpression: string;

  /**
   * Environment variable that disables this task at runtime when set to the
   * literal string `'false'`. Checked at both registration time and at every
   * cron tick (so toggling without a restart works). Defaults to enabled.
   *
   * Example: `'OL_ALLEGRO_POLL_SCHEDULER_ENABLED'`.
   */
  enabledEnvVar?: string;

  /**
   * Default enablement when `enabledEnvVar` is unset. Defaults to `true`
   * (enabled). Set `false` for a task that must stay opt-in until an operator
   * explicitly turns it on — e.g. the offline-resubmit sweep, whose duplicate-
   * issue safety depends on a provider wire contract an operator must verify
   * against their own authority before enabling (#1585 B1).
   */
  enabledDefault?: boolean;

  /**
   * Optional custom connection filter (overrides default platformType-based
   * lookup). Used for capability-based scheduling that spans multiple
   * platforms — e.g. drain every connection that supports the
   * `InventoryMaster` capability regardless of platform.
   *
   * **Required unless `platformType` is set.** Mutually exclusive with
   * `platformType` — when both are supplied, `connectionFilter` wins.
   */
  connectionFilter?: () => Promise<Connection[]>;

  /**
   * Optional capability gate applied ON TOP of `platformType`-based lookup
   * (ignored when `connectionFilter` is set — that callback owns its own
   * filtering). When present, a connection is only enqueued if
   * `connection.enabledCapabilities` includes this value.
   *
   * Without this, a `platformType`-scoped task (e.g. a per-platform
   * orders-poll) enqueues for every active connection of that platform
   * regardless of whether the connection actually has the relevant
   * capability enabled — a connection with `OrderSource` deliberately
   * disabled (e.g. a WooCommerce connection used only for product
   * publishing) still got polled every tick, failed every time with
   * `CapabilityNotEnabledException`, and spammed ERROR logs forever
   * (confirmed live during manual E2E testing of #1322).
   */
  requiredCapability?: string;

  /**
   * Generate the job payload for a specific connection. Invoked once per
   * tick per active connection.
   */
  generatePayload: (connection: Connection) => Record<string, unknown>;

  /**
   * Generate the idempotency key for a job enqueue. The `timestamp`
   * argument is the current minute, formatted as `YYYY-MM-DD-HH-MM`, so
   * keys collapse intra-minute duplicates if a tick re-fires.
   */
  generateIdempotencyKey: (connection: Connection, timestamp: string) => string;
}
