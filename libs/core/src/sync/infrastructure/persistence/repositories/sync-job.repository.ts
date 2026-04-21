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
import { Repository, DataSource, QueryFailedError, EntityManager } from 'typeorm';
import { randomUUID } from 'crypto';
import { SyncJobOrmEntity } from '../entities/sync-job.orm-entity';
import { SyncJobRepositoryPort } from '../../../domain/ports/sync-job-repository.port';
import { SyncJob } from '../../../domain/entities/sync-job.entity';
import { InvalidSyncJobStateError } from '../../../domain/exceptions/invalid-sync-job-state.error';
import { SyncJobNotFoundError } from '../../../domain/exceptions/sync-job-not-found.error';
import {
  JobStatus,
  JobStatusValues,
  JobType,
  JobTypeValues,
  SyncJobFilters,
  SyncJobPagination,
  PaginatedSyncJobs,
  SyncJobGroup,
  SyncJobGroupsResult,
  SyncJobGroupFilters,
  BulkRetryResult,
} from '../../../domain/types/sync-job.types';

@Injectable()
export class SyncJobRepository implements SyncJobRepositoryPort {
  constructor(
    @InjectRepository(SyncJobOrmEntity)
    private readonly repository: Repository<SyncJobOrmEntity>,
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
      entity.maxAttempts = 10;
      entity.nextRunAt = new Date();
      entity.lockedAt = null;
      entity.lockedBy = null;
      entity.lastError = null;

      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      // Handle unique constraint violation (race condition)
      if (
        error instanceof QueryFailedError &&
        (error.message.includes('duplicate key') ||
          error.message.includes('unique constraint'))
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
          throw new Error(
            `Failed to create or find job by idempotency key: ${job.idempotencyKey}`,
          );
        }
        return this.toDomain(existing);
      }
      throw error;
    }
  }

  async findAndLockDueJobs(limit: number, workerId: string): Promise<SyncJob[]> {
    // Use transaction with FOR UPDATE SKIP LOCKED for atomic locking
    return this.dataSource.transaction(async (manager: EntityManager) => {
      const now = new Date();

      // Use raw SQL for FOR UPDATE SKIP LOCKED (TypeORM doesn't support SKIP LOCKED directly)
      // Note: Column names use camelCase with quotes to match migration schema
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const rawEntities = await manager.query(
        `
        SELECT * FROM sync_jobs
        WHERE status = $1 AND "nextRunAt" <= $2
        ORDER BY "nextRunAt" ASC
        LIMIT $3
        FOR UPDATE SKIP LOCKED
        `,
        ['queued', now, limit],
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (rawEntities.length === 0) {
        return [];
      }

      // Update locked jobs
      // TypeORM query returns any[], so we need to extract IDs safely
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
      const ids = rawEntities.map((e: { id: string }) => e.id);
      await manager
        .createQueryBuilder()
        .update(SyncJobOrmEntity)
        .set({
          status: 'running',
          lockedAt: now,
          lockedBy: workerId,
        })
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        .where('id IN (:...ids)', { ids })
        .execute();

      // Reload to get updated status
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const updated = await manager.find(SyncJobOrmEntity, {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
        where: ids.map((id: string) => ({ id })),
      });
      return updated.map((e: SyncJobOrmEntity) => this.toDomain(e));
    });
  }

  async markSucceeded(id: string): Promise<void> {
    await this.repository.update(id, {
      status: 'succeeded',
      lockedAt: null,
      lockedBy: null,
      lastError: null,
    });
  }

  async markFailed(id: string, error: string, nextRunAt: Date): Promise<void> {
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
    });
  }

  async markDead(id: string, error: string): Promise<void> {
    await this.repository.update(id, {
      status: 'dead',
      lockedAt: null,
      lockedBy: null,
      lastError: error.length > 1000 ? error.substring(0, 1000) : error, // Truncate if too long
    });
  }

  async findById(id: string): Promise<SyncJob | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findMany(filters: SyncJobFilters, pagination: SyncJobPagination): Promise<PaginatedSyncJobs> {
    const where: { status?: string; connectionId?: string; jobType?: string } = {};
    if (filters.status) where.status = filters.status;
    if (filters.connectionId) where.connectionId = filters.connectionId;
    if (filters.jobType) where.jobType = filters.jobType;

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

  async findRecentByConnectionId(connectionId: string, limit: number): Promise<SyncJob[]> {
    const entities = await this.repository.find({
      where: { connectionId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return entities.map((e) => this.toDomain(e));
  }

  async findGroupedByStatus(
    filters: SyncJobGroupFilters,
    maxGroups: number,
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
    maxBatchSize: number,
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
}

