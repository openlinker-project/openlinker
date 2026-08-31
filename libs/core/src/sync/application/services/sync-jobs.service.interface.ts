/**
 * Sync Jobs Service Interface
 *
 * Cross-context application surface for scheduling sync jobs. The
 * single method (`schedule`) bypasses the Redis-stream queue path
 * on purpose — the stream backend does not support delayed delivery —
 * and writes the job row directly through `SyncJobRepositoryPort`.
 * The worker's polling loop (`nextRunAt <= now()`) picks the row up
 * at the requested time.
 *
 * @module libs/core/src/sync/application/services
 * @see {@link SyncJobsService} for the implementation
 */
import type { SyncJob } from '../../domain/entities/sync-job.entity';
import type { JobType } from '../../domain/types/sync-job.types';
import type { SchedulerTaskConfig } from '../../domain/types/scheduler-task.types';
import type { ScheduleJobInput } from './sync-jobs.types';

export interface ISyncJobsService {
  /**
   * Schedule a sync job with a required `runAfter`, idempotently.
   *
   * This path inserts the job directly via the sync-job repository
   * rather than the Redis-stream queue, because the stream-based
   * enqueue (`SyncJobQueuePort.enqueue`) does not deliver messages
   * on a future timestamp. The worker's polling loop picks the job
   * up when `nextRunAt <= now()`.
   *
   * Returns the persisted job — the freshly-created row, or the
   * pre-existing row when the idempotency key has already been seen.
   */
  schedule(input: ScheduleJobInput): Promise<SyncJob>;

  /**
   * Re-drive a job that has exhausted its retries by requeuing it (#1585 I3).
   * Looks the job up by its `idempotencyKey` and, ONLY when it is currently in
   * `dead` status, resets it to `queued` (attempts=0, nextRunAt=now) so the
   * worker re-runs it. A no-op returning `false` when no job holds the key, or
   * the job is not `dead` (still queued/running — it will re-drive itself). This
   * is the safe re-drive seam for a never-transmitted `pending` invoice whose
   * original `invoicing.issue` job died: re-running the SAME idempotency-keyed
   * job resumes issuance against the existing record (no double-issue).
   */
  requeueDeadByIdempotencyKey(idempotencyKey: string): Promise<boolean>;

  /**
   * Read the job held under an idempotency key, or null when none exists
   * (#2526).
   *
   * A pure read - it does not requeue, re-drive or otherwise touch the row,
   * which is what separates it from {@link requeueDeadByIdempotencyKey}. It
   * exists because a caller that enqueued work under a deterministic key needs
   * to tell "queued" from "never asked" and from "gave up", and the work's own
   * record cannot answer that: between the job being written and the job running
   * there is nothing else to read.
   */
  findJobByIdempotencyKey(idempotencyKey: string): Promise<SyncJob | null>;

  /**
   * Requeue every job left `running` past the lock timeout — the fleet-level
   * recovery sweep for a worker that died holding jobs (#2279's
   * `StuckJobRecoveryService`, extracted from `SyncJobRunner` for the
   * `maintenance` role).
   *
   * Idempotent across replicas by construction: the repository applies a
   * single conditional UPDATE keyed on a stale `lockedAt`, so two maintenance
   * processes sweeping concurrently cannot double-requeue a job.
   *
   * @param timeoutMinutes - Age of `lockedAt` past which a running job is
   *   considered abandoned
   * @returns how many jobs were requeued
   */
  requeueStuckJobs(timeoutMinutes: number): Promise<number>;

  /**
   * Find the most recently succeeded job for a connection + job type,
   * ordered by completion time (`updatedAt`) — the cross-context read seam
   * for "when did this connection last successfully run job X" (#1982,
   * e.g. the analytics data-trust freshness read). Returns null when no
   * succeeded job exists yet.
   */
  findLastSucceededJob(connectionId: string, jobType: JobType): Promise<SyncJob | null>;

  /**
   * Find the registered scheduler task for a platform + job type, but only
   * when it is currently *enabled* (respects `enabledEnvVar` /
   * `enabledDefault` — the same runtime enablement check `SchedulerService`
   * applies before executing a tick). Returns null when no task is
   * registered for the platform, or when one is registered but disabled.
   *
   * This is the cross-context seam for "what's this connection's live poll
   * cadence" (#1982) — it keeps `SchedulerTaskRegistryService` (a concrete
   * infrastructure class, not a port or service interface) from being
   * injected directly by a sibling context.
   */
  findEnabledPollTask(platformType: string, jobType: JobType): SchedulerTaskConfig | null;

  /**
   * Find the registered scheduler task for a job type, but only when it is
   * currently *enabled* — the same runtime enablement semantics as
   * `findEnabledPollTask`, without the `platformType` filter (#2258).
   *
   * Intended for CAPABILITY-scoped tasks (registered with a `connectionFilter`
   * and no `platformType` — e.g. the master delta/reconcile sweeps), which
   * `findEnabledPollTask` can never match. The registry permits multiple
   * tasks per job type; this method returns the FIRST enabled match, so
   * callers looking up a per-platform job type should use
   * `findEnabledPollTask` instead.
   *
   * Process caveat: the scheduler-task registry is populated only where
   * `SchedulerService` runs (the API process). In a process without a
   * scheduler — the worker — the registry is empty and this method silently
   * returns null; do not read "null" as "disabled" outside the API process.
   */
  findEnabledTaskByJobType(jobType: JobType): SchedulerTaskConfig | null;
}
