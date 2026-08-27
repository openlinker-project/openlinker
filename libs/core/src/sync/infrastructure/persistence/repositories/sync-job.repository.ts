/**
 * Sync Job Repository
 *
 * Repository implementation for sync job persistence operations.
 * Provides data access methods for finding, creating, and updating sync jobs,
 * with conversion between domain entities and ORM entities. Includes
 * transaction-safe locking using PostgreSQL FOR UPDATE SKIP LOCKED.
 *
 * Implements SyncJobRepositoryPort to maintain proper dependency
 * direction and enable easy testing/mocking.
 *
 * @module libs/core/src/sync/infrastructure/persistence/repositories
 * @implements {SyncJobRepositoryPort}
 * @see {@link SyncJobOrmEntity} for the database entity
 * @see {@link SyncJobRepositoryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { DataSource, EntityManager } from 'typeorm';
import { Repository, QueryFailedError, Not, IsNull } from 'typeorm';
import { randomUUID } from 'crypto';
import { SyncJobOrmEntity } from '../entities/sync-job.orm-entity';
import type { SyncJobRepositoryPort } from '../../../domain/ports/sync-job-repository.port';
import { SyncJob } from '../../../domain/entities/sync-job.entity';
import { InvalidSyncJobStateError } from '../../../domain/exceptions/invalid-sync-job-state.error';
import { SyncJobNotFoundError } from '../../../domain/exceptions/sync-job-not-found.error';
import type { ConnectionBacklogStats } from '../../../domain/types/connection-sync-status.types';
import type {
  JobOutcome,
  JobOutcomeReason,
  JobStatus,
  JobType,
  SyncJobFilters,
  SyncJobPagination,
  PaginatedSyncJobs,
  SyncJobGroup,
  SyncJobGroupsResult,
  SyncJobGroupFilters,
  BulkRetryResult,
  PenaltyFreeRequeuePatch,
} from '../../../domain/types/sync-job.types';
import {
  JobOutcomeValues,
  JobOutcomeReasonValues,
  JobStatusValues,
  JobTypeValues,
} from '../../../domain/types/sync-job.types';

@Injectable()
export class SyncJobRepository implements SyncJobRepositoryPort {
  constructor(
    @InjectRepository(SyncJobOrmEntity)
    private readonly repository: Repository<SyncJobOrmEntity>
  ) {}

  /**
   * Get DataSource from repository connection
   * This is a workaround for injecting DataSource in core library modules
   */
  private get dataSource(): DataSource {
    return this.repository.manager.connection;
  }

  async createIfNotExistsByIdempotencyKey(
    job: Omit<
      SyncJob,
      | 'id'
      | 'status'
      | 'attempts'
      | 'nextRunAt'
      | 'lockedAt'
      | 'lockedBy'
      | 'lastError'
      | 'createdAt'
      | 'updatedAt'
    >,
    options?: { runAfter?: Date }
  ): Promise<SyncJob> {
    // Try to create job - handle race condition with unique constraint
    try {
      const entity = new SyncJobOrmEntity();
      entity.id = randomUUID();
      entity.jobType = job.jobType;
      entity.connectionId = job.connectionId;
      entity.payloadJson = job.payload;
      entity.status = 'queued';
      entity.idempotencyKey = job.idempotencyKey;
      entity.attempts = 0;
      entity.maxAttempts = job.maxAttempts ?? 10;
      entity.nextRunAt = options?.runAfter ?? new Date();
      entity.lockedAt = null;
      entity.lockedBy = null;
      entity.lastError = null;
      entity.outcome = null;
      entity.outcomeReason = null;
      entity.lastAttemptDurationMs = null;
      entity.deferredTotalMs = null;

      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      // Handle unique constraint violation (race condition)
      if (
        error instanceof QueryFailedError &&
        (error.message.includes('duplicate key') || error.message.includes('unique constraint'))
      ) {
        // Job already exists, fetch and return it
        // Retry with a small delay to handle race conditions
        let existing = await this.repository.findOne({
          where: { idempotencyKey: job.idempotencyKey },
        });

        // If still not found, wait a bit and retry (race condition handling)
        if (!existing) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          existing = await this.repository.findOne({
            where: { idempotencyKey: job.idempotencyKey },
          });
        }

        if (!existing) {
          throw new Error(`Failed to create or find job by idempotency key: ${job.idempotencyKey}`);
        }
        return this.toDomain(existing);
      }
      throw error;
    }
  }

  async findAndLockDueJobs(limit: number, workerId: string): Promise<SyncJob[]> {
    return this.claimDueJobs({ limit, workerId });
  }

  async findAndLockDueJobsForLane(input: {
    jobTypes: JobType[];
    limit: number;
    workerId: string;
    excludedScopes?: string[];
  }): Promise<SyncJob[]> {
    if (input.jobTypes.length === 0) {
      return [];
    }
    return this.claimDueJobs(input);
  }

  /**
   * Shared claim body for both claim methods (ADR-050, #2278). The lane axes
   * (`jobTypes`, `excludedScopes`) are additive SQL arms over the original
   * claim; in-lane ordering stays `ORDER BY "nextRunAt" ASC`.
   */
  private async claimDueJobs(input: {
    limit: number;
    workerId: string;
    jobTypes?: JobType[];
    excludedScopes?: string[];
  }): Promise<SyncJob[]> {
    // Use transaction with FOR UPDATE SKIP LOCKED for atomic locking
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const now = new Date();

      const params: unknown[] = ['queued', now];
      let where = `status = $1 AND "nextRunAt" <= $2`;
      if (input.jobTypes && input.jobTypes.length > 0) {
        params.push(input.jobTypes);
        where += ` AND "jobType" = ANY($${params.length})`;
      }
      if (input.excludedScopes && input.excludedScopes.length > 0) {
        params.push(input.excludedScopes);
        where += ` AND "connectionId" != ALL($${params.length})`;
      }
      params.push(input.limit);

      // Use raw SQL for FOR UPDATE SKIP LOCKED (TypeORM doesn't support SKIP LOCKED directly)
      // Note: Column names use camelCase with quotes to match migration schema
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- typeorm raw-query / find result is untyped; shape verified by the surrounding mapper
      const rawEntities = await manager.query(
        `
        SELECT * FROM sync_jobs
        WHERE ${where}
        ORDER BY "nextRunAt" ASC
        LIMIT $${params.length}
        FOR UPDATE SKIP LOCKED
        `,
        params
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- typeorm raw-query / find result is untyped; shape verified by the surrounding mapper
      if (rawEntities.length === 0) {
        return [];
      }

      // Update locked jobs
      // TypeORM query returns any[], so we need to extract IDs safely
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- typeorm raw-query / find result is untyped; shape verified by the surrounding mapper
      const ids = rawEntities.map((e: { id: string }) => e.id);
      await manager
        .createQueryBuilder()
        .update(SyncJobOrmEntity)
        .set({
          status: 'running',
          lockedAt: now,
          lockedBy: input.workerId,
        })
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- typeorm raw-query / find result is untyped; shape verified by the surrounding mapper
        .where('id IN (:...ids)', { ids })
        .execute();

      // Reload to get updated status
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- typeorm raw-query / find result is untyped; shape verified by the surrounding mapper
      const updated = await manager.find(SyncJobOrmEntity, {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access -- typeorm raw-query / find result is untyped; shape verified by the surrounding mapper
        where: ids.map((id: string) => ({ id })),
      });
      return updated.map((e: SyncJobOrmEntity) => this.toDomain(e));
    });
  }

  async markSucceeded(
    id: string,
    outcome: JobOutcome,
    outcomeReason?: JobOutcomeReason,
    lastAttemptDurationMs?: number
  ): Promise<void> {
    await this.repository.update(id, {
      status: 'succeeded',
      outcome,
      outcomeReason: outcomeReason ?? null,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      ...this.durationPatch(lastAttemptDurationMs),
    });
  }

  async markFailed(
    id: string,
    error: string,
    nextRunAt: Date,
    lastAttemptDurationMs?: number
  ): Promise<void> {
    const job = await this.repository.findOne({ where: { id } });
    if (!job) {
      throw new Error(`Job not found: ${id}`);
    }

    // Requeue the job so it can be picked up again after nextRunAt
    await this.repository.update(id, {
      status: 'queued',
      attempts: job.attempts + 1,
      nextRunAt,
      lockedAt: null,
      lockedBy: null,
      lastError: error.length > 1000 ? error.substring(0, 1000) : error, // Truncate if too long
      ...this.durationPatch(lastAttemptDurationMs),
    });
  }

  async markDead(id: string, error: string, lastAttemptDurationMs?: number | null): Promise<void> {
    await this.repository.update(id, {
      status: 'dead',
      lockedAt: null,
      lockedBy: null,
      lastError: error.length > 1000 ? error.substring(0, 1000) : error, // Truncate if too long
      ...this.durationPatch(lastAttemptDurationMs),
    });
  }

  /**
   * Build the duration half of a status patch (#2611).
   *
   * Tri-state on purpose. `undefined` (not supplied) yields an EMPTY patch and
   * leaves whatever was recorded, because a caller that did not measure has
   * nothing to say. An explicit `null` CLEARS the column, which a caller passes
   * when it knows no attempt ran - otherwise a previous attempt's number would
   * sit beside a new status and describe a different attempt than `lastError`.
   * A number is recorded, including a real `0`: that is a genuinely instant run
   * and an operator can tell it apart from "unmeasured" only because the column
   * is otherwise NULL. A non-finite or negative value is dropped - a clock that
   * moved backwards is not evidence of a fast job.
   */
  private durationPatch(
    lastAttemptDurationMs?: number | null
  ): Partial<Pick<SyncJobOrmEntity, 'lastAttemptDurationMs'>> {
    if (lastAttemptDurationMs === null) {
      return { lastAttemptDurationMs: null };
    }
    if (
      lastAttemptDurationMs === undefined ||
      !Number.isFinite(lastAttemptDurationMs) ||
      lastAttemptDurationMs < 0
    ) {
      return {};
    }
    return { lastAttemptDurationMs: Math.round(lastAttemptDurationMs) };
  }

  async requeueWithoutPenalty(
    id: string,
    error: string,
    nextRunAt: Date,
    patch?: PenaltyFreeRequeuePatch
  ): Promise<void> {
    // Deliberately omits `attempts` — this is the one difference from
    // markFailed (#1810 review follow-up on #1957). A rate-limit-timeout
    // requeue must not consume retry budget.
    await this.repository.update(id, {
      status: 'queued',
      nextRunAt,
      lockedAt: null,
      lockedBy: null,
      lastError: error.length > 1000 ? error.substring(0, 1000) : error, // Truncate if too long
      // Written in the same UPDATE as the requeue so the deferral budget can
      // never drift from the state it bounds (#2613).
      ...(patch?.deferredTotalMs === undefined
        ? {}
        : { deferredTotalMs: Math.round(patch.deferredTotalMs) }),
      ...this.durationPatch(patch?.lastAttemptDurationMs),
    });
  }

  async findById(id: string): Promise<SyncJob | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<SyncJob | null> {
    const entity = await this.repository.findOne({ where: { idempotencyKey } });
    return entity ? this.toDomain(entity) : null;
  }

  async findMany(
    filters: SyncJobFilters,
    pagination: SyncJobPagination
  ): Promise<PaginatedSyncJobs> {
    const where: { status?: string; connectionId?: string; jobType?: string; outcome?: string } =
      {};
    if (filters.status) where.status = filters.status;
    if (filters.connectionId) where.connectionId = filters.connectionId;
    if (filters.jobType) where.jobType = filters.jobType;
    if (filters.outcome) where.outcome = filters.outcome;

    const [entities, total] = await this.repository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: pagination.limit,
      skip: pagination.offset,
    });

    return { items: entities.map((e) => this.toDomain(e)), total };
  }

  async requeueStuckJobs(lockTimeoutMinutes: number): Promise<number> {
    const threshold = new Date();
    threshold.setMinutes(threshold.getMinutes() - lockTimeoutMinutes);

    const result = await this.repository
      .createQueryBuilder()
      .update(SyncJobOrmEntity)
      .set({
        status: 'queued',
        lockedAt: null,
        lockedBy: null,
      })
      .where('status = :status', { status: 'running' })
      .andWhere('"lockedAt" < :threshold', { threshold })
      .execute();

    return result.affected || 0;
  }

  async requeueDeadJob(id: string): Promise<SyncJob> {
    // Atomic conditional update — avoids TOCTOU race between status check and update
    const result = await this.repository
      .createQueryBuilder()
      .update(SyncJobOrmEntity)
      .set({
        status: 'queued',
        attempts: 0,
        nextRunAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      })
      .where('id = :id AND status = :status', { id, status: 'dead' })
      .execute();

    if (result.affected === 0) {
      // Distinguish not-found from wrong-status
      const existing = await this.repository.findOne({ where: { id } });
      if (!existing) {
        throw new SyncJobNotFoundError(id);
      }
      throw new InvalidSyncJobStateError('status', existing.status, id);
    }

    const updated = await this.repository.findOne({ where: { id } });
    if (!updated) {
      throw new SyncJobNotFoundError(id);
    }
    return this.toDomain(updated);
  }

  async requeueDeadByIdempotencyKey(idempotencyKey: string): Promise<boolean> {
    // Single guarded UPDATE (#1585 S3): the status='dead' predicate lives IN the
    // write, so two overlapping recovery runs cannot both observe `dead` and both
    // requeue - Postgres serialises the row write and exactly one gets affected>0.
    const result = await this.repository
      .createQueryBuilder()
      .update(SyncJobOrmEntity)
      .set({
        status: 'queued',
        attempts: 0,
        nextRunAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      })
      .where('idempotencyKey = :idempotencyKey AND status = :status', {
        idempotencyKey,
        status: 'dead',
      })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async findRecentByConnectionId(connectionId: string, limit: number): Promise<SyncJob[]> {
    const entities = await this.repository.find({
      where: { connectionId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return entities.map((e) => this.toDomain(e));
  }

  async findLastSucceededByConnectionAndJobType(
    connectionId: string,
    jobType: JobType
  ): Promise<SyncJob | null> {
    const entity = await this.repository.findOne({
      // ADR-007: `status: 'succeeded'` is orchestration, `outcome` is the
      // business result. Excludes a succeeded-but-business_failure job
      // (e.g. `master.product.syncByExternalId` with `outcomeReason:
      // 'master_deleted'`) from being reported as a "successful" run.
      //
      // `outcome` is NOT always set: `1790000000003-add-outcome-to-sync-jobs`
      // added the column nullable with no backfill, so a succeeded job that
      // predates ADR-007's atomic status/outcome flip carries NULL. A plain
      // `outcome: Not('business_failure')` would exclude those rows too (SQL
      // `!= x` on NULL is NULL, not true), reporting a false "never
      // succeeded" for exactly the read this method exists to answer
      // honestly. The two-branch OR below (array = OR across TypeORM
      // `where` objects) explicitly admits both "known-not-business_failure"
      // and "outcome was never recorded" as successful.
      where: [
        { connectionId, jobType, status: 'succeeded', outcome: Not('business_failure') },
        { connectionId, jobType, status: 'succeeded', outcome: IsNull() },
      ],
      // No two rows share a (connectionId, jobType, status) at the same
      // updatedAt in practice, but a deterministic tiebreaker (mirroring
      // requeueDeadJobsInGroup's own ordering) removes the ambiguity.
      order: { updatedAt: 'DESC', id: 'DESC' },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findGroupedByStatus(
    filters: SyncJobGroupFilters,
    maxGroups: number
  ): Promise<SyncJobGroupsResult> {
    // Inputs are DTO-validated upstream (IsEnum JobStatus, IsUUID, @Max(100)).
    // Raw SQL used because TypeORM QueryBuilder doesn't model window functions cleanly.
    const groupsSql = `
      WITH ranked AS (
        SELECT
          id,
          "connectionId",
          "jobType",
          "updatedAt",
          "lastError",
          COUNT(*) OVER (PARTITION BY "connectionId", "jobType") AS group_count,
          ROW_NUMBER() OVER (
            PARTITION BY "connectionId", "jobType"
            ORDER BY "updatedAt" DESC, id DESC
          ) AS rn
        FROM sync_jobs
        WHERE status = $1
          AND ($2::uuid IS NULL OR "connectionId" = $2)
      )
      SELECT
        "connectionId" AS connection_id,
        "jobType" AS job_type,
        group_count,
        "updatedAt" AS latest_updated_at,
        id AS representative_job_id,
        "lastError" AS last_error
      FROM ranked
      WHERE rn = 1
      ORDER BY group_count DESC, "updatedAt" DESC
      LIMIT $3
    `;
    const totalsSql = `
      SELECT
        COUNT(*)::int AS total_jobs,
        COUNT(DISTINCT ("connectionId", "jobType"))::int AS total_groups
      FROM sync_jobs
      WHERE status = $1
        AND ($2::uuid IS NULL OR "connectionId" = $2)
    `;

    interface GroupRow {
      connection_id: string;
      job_type: string;
      group_count: string; // Postgres COUNT() returns bigint → serialized as string
      latest_updated_at: Date;
      representative_job_id: string;
      last_error: string | null;
    }
    interface TotalsRow {
      total_jobs: number;
      total_groups: number;
    }

    const params = [filters.status, filters.connectionId ?? null, maxGroups];
    const [rows, totals] = await Promise.all([
      this.dataSource.query<GroupRow[]>(groupsSql, params),
      this.dataSource.query<TotalsRow[]>(totalsSql, [filters.status, filters.connectionId ?? null]),
    ]);

    const groups: SyncJobGroup[] = rows.map((row) => {
      if (!this.isValidJobType(row.job_type)) {
        throw new InvalidSyncJobStateError('jobType', row.job_type, row.representative_job_id);
      }
      return {
        connectionId: row.connection_id,
        jobType: row.job_type,
        count: Number(row.group_count),
        latestUpdatedAt: row.latest_updated_at,
        representativeJobId: row.representative_job_id,
        lastError: row.last_error,
      };
    });

    return {
      groups,
      totalGroups: totals[0]?.total_groups ?? 0,
      totalJobs: totals[0]?.total_jobs ?? 0,
    };
  }

  async requeueDeadJobsInGroup(
    connectionId: string,
    jobType: string,
    maxBatchSize: number
  ): Promise<BulkRetryResult> {
    // Two-query approach: SELECT the batch, then UPDATE with status='dead' guard.
    // The guard tolerates the rare race where a job flipped out of 'dead' between
    // SELECT and UPDATE; such jobs count as `skipped`, never double-enqueued.
    const candidates = await this.repository.find({
      where: { connectionId, jobType, status: 'dead' },
      select: { id: true },
      order: { updatedAt: 'DESC', id: 'DESC' },
      take: maxBatchSize,
    });

    if (candidates.length === 0) {
      return { requeuedJobIds: [], count: 0, skipped: 0 };
    }

    const candidateIds = candidates.map((c) => c.id);
    const result = await this.repository
      .createQueryBuilder()
      .update(SyncJobOrmEntity)
      .set({
        status: 'queued',
        attempts: 0,
        nextRunAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      })
      .where('id IN (:...ids)', { ids: candidateIds })
      .andWhere('status = :dead', { dead: 'dead' })
      .returning('id')
      .execute();

    const requeuedJobIds = (result.raw as Array<{ id: string }>).map((r) => r.id);
    return {
      requeuedJobIds,
      count: requeuedJobIds.length,
      skipped: candidateIds.length - requeuedJobIds.length,
    };
  }

  async getConnectionBacklogStats(
    connectionId: string,
    windowStart: Date
  ): Promise<ConnectionBacklogStats> {
    // One round trip. Every figure is an aggregate over this connection's rows
    // only, so the response size does not grow with the number of jobs - a
    // 15 000-job backlog returns the same single row a 3-job one does. The
    // scan is assisted by the existing (connectionId, createdAt) index.
    //
    // The duration average uses FILTER on IS NOT NULL, and the sample size is
    // COUNT of the same non-null set (#2611): the column is null on every row
    // predating its migration, and counting those as zero would understate
    // every real duration. AVG already ignores nulls; the explicit FILTER on
    // the count is what lets a caller see how thin the sample is.
    const sql = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'queued')::int AS queued_count,
        COUNT(*) FILTER (WHERE status = 'running')::int AS running_count,
        COUNT(*) FILTER (WHERE status = 'dead')::int AS dead_count,
        COUNT(*) FILTER (WHERE "createdAt" >= $2)::int AS arrived_in_window,
        COUNT(*) FILTER (
          WHERE status IN ('succeeded', 'dead') AND "updatedAt" >= $2
        )::int AS completed_in_window,
        AVG("lastAttemptDurationMs") FILTER (
          WHERE status IN ('succeeded', 'dead')
            AND "updatedAt" >= $2
            AND "lastAttemptDurationMs" IS NOT NULL
        ) AS avg_attempt_duration_ms,
        COUNT(*) FILTER (
          WHERE status IN ('succeeded', 'dead')
            AND "updatedAt" >= $2
            AND "lastAttemptDurationMs" IS NOT NULL
        )::int AS attempt_duration_sample_size,
        MIN("createdAt") FILTER (WHERE status = 'queued') AS oldest_queued_at
      FROM sync_jobs
      WHERE "connectionId" = $1
    `;

    interface StatsRow {
      queued_count: number;
      running_count: number;
      dead_count: number;
      arrived_in_window: number;
      completed_in_window: number;
      // Postgres AVG over an integer column returns numeric, serialized as a string.
      avg_attempt_duration_ms: string | null;
      attempt_duration_sample_size: number;
      oldest_queued_at: Date | null;
    }

    const rows = await this.dataSource.query<StatsRow[]>(sql, [connectionId, windowStart]);
    const row = rows[0];
    if (!row) {
      return {
        queuedCount: 0,
        runningCount: 0,
        deadCount: 0,
        arrivedInWindow: 0,
        completedInWindow: 0,
        averageAttemptDurationMs: null,
        attemptDurationSampleSize: 0,
        oldestQueuedAt: null,
      };
    }

    return {
      queuedCount: row.queued_count,
      runningCount: row.running_count,
      deadCount: row.dead_count,
      arrivedInWindow: row.arrived_in_window,
      completedInWindow: row.completed_in_window,
      averageAttemptDurationMs:
        row.avg_attempt_duration_ms === null ? null : Number(row.avg_attempt_duration_ms),
      attemptDurationSampleSize: row.attempt_duration_sample_size,
      oldestQueuedAt: row.oldest_queued_at,
    };
  }

  async heartbeat(id: string, workerId: string): Promise<void> {
    // Guarded on lockedBy so a heartbeat from a worker that lost the job
    // (already requeued and re-picked by another worker) is a no-op.
    await this.repository
      .createQueryBuilder()
      .update(SyncJobOrmEntity)
      .set({ lockedAt: new Date() })
      .where('id = :id AND status = :status AND "lockedBy" = :workerId', {
        id,
        status: 'running',
        workerId,
      })
      .execute();
  }

  /**
   * Map ORM entity to domain entity
   */
  private toDomain(entity: SyncJobOrmEntity): SyncJob {
    // Validate job type
    if (!this.isValidJobType(entity.jobType)) {
      throw new InvalidSyncJobStateError('jobType', entity.jobType, entity.id);
    }

    // Validate job status
    if (!this.isValidJobStatus(entity.status)) {
      throw new InvalidSyncJobStateError('status', entity.status, entity.id);
    }

    // Validate outcome if present. NULL/undefined is the expected resting state
    // for non-succeeded jobs and historical rows pre-dating issue #400.
    if (
      entity.outcome !== null &&
      entity.outcome !== undefined &&
      !this.isValidJobOutcome(entity.outcome)
    ) {
      throw new InvalidSyncJobStateError('outcome', entity.outcome, entity.id);
    }

    // Validate outcomeReason if present. NULL/undefined is the expected
    // resting state for jobs with no finer outcome classification (#1689).
    if (
      entity.outcomeReason !== null &&
      entity.outcomeReason !== undefined &&
      !this.isValidJobOutcomeReason(entity.outcomeReason)
    ) {
      throw new InvalidSyncJobStateError('outcomeReason', entity.outcomeReason, entity.id);
    }

    return new SyncJob(
      entity.id,
      entity.jobType,
      entity.connectionId,
      entity.payloadJson,
      entity.status,
      entity.idempotencyKey,
      entity.attempts,
      entity.maxAttempts,
      entity.nextRunAt,
      entity.lockedAt,
      entity.lockedBy,
      entity.lastError,
      entity.createdAt,
      entity.updatedAt,
      entity.outcome ?? null,
      entity.outcomeReason ?? null,
      entity.lastAttemptDurationMs ?? null,
      entity.deferredTotalMs ?? null
    );
  }

  /**
   * Type guard for JobType
   */
  private isValidJobType(value: string): value is JobType {
    return (JobTypeValues as readonly string[]).includes(value);
  }

  /**
   * Type guard for JobStatus
   */
  private isValidJobStatus(value: string): value is JobStatus {
    return (JobStatusValues as readonly string[]).includes(value);
  }

  /**
   * Type guard for JobOutcome
   */
  private isValidJobOutcome(value: string): value is JobOutcome {
    return (JobOutcomeValues as readonly string[]).includes(value);
  }

  /**
   * Type guard for JobOutcomeReason
   */
  private isValidJobOutcomeReason(value: string): value is JobOutcomeReason {
    return (JobOutcomeReasonValues as readonly string[]).includes(value);
  }
}
