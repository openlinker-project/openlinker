/**
 * Sync Job ORM Entity
 *
 * TypeORM entity representing the sync_jobs table in PostgreSQL.
 * Stores persisted sync jobs for durable retries, observability, and idempotency.
 *
 * @module libs/core/src/sync/infrastructure/persistence/entities
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('sync_jobs')
@Index(['status', 'nextRunAt'])
@Index(['lockedAt'])
@Index(['connectionId', 'createdAt']) // Supports findRecentByConnectionId diagnostics query
// Supports findLastSucceededByConnectionAndJobType (#1982) — a render-blocking read, once per connection.
// Explicitly named to match the migration's index name — an unnamed decorator gets a
// TypeORM-derived hash name, which would make a future migration:generate propose a duplicate.
@Index('IDX_sync_jobs_connectionId_jobType_status_updatedAt', [
  'connectionId',
  'jobType',
  'status',
  'updatedAt',
])
export class SyncJobOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  jobType!: string;

  @Column('uuid')
  connectionId!: string;

  @Column({ type: 'jsonb' })
  payloadJson!: Record<string, unknown>;

  @Column({ type: 'varchar' })
  status!: string; // 'queued' | 'running' | 'succeeded' | 'dead'

  /**
   * Business outcome of the run (`'ok' | 'business_failure'`); null for
   * non-succeeded jobs. See issue #400 (Plan B for #391).
   */
  @Column({ type: 'varchar', nullable: true })
  outcome!: string | null;

  /**
   * Stable machine-readable code further classifying `outcome` (#1689),
   * e.g. `'master_deleted'`. Null when the outcome needs no finer
   * classification, or for historical rows predating the column.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  outcomeReason!: string | null;

  @Column({ type: 'varchar', unique: true })
  idempotencyKey!: string;

  @Column({ default: 0 })
  attempts!: number;

  @Column({ default: 10 })
  maxAttempts!: number;

  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  nextRunAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  lockedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  lockedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  /**
   * Wall-clock milliseconds of the most recently COMPLETED attempt (#2611),
   * including any time that attempt spent waiting for a per-connection
   * rate-limit slot. Written in the same UPDATE as the status transition that ended
   * that attempt, so it always describes the same attempt the row's
   * status/outcome/lastError describe.
   *
   * Not derivable from the other columns: the heartbeat rewrites `lockedAt`
   * every few minutes while a job runs, and `updatedAt - createdAt` includes
   * queue wait and retry backoff.
   *
   * `null` for a job that has never completed an attempt, and for every row
   * predating this column. Never treat `null` as zero.
   */
  @Column({ type: 'integer', nullable: true })
  lastAttemptDurationMs!: number | null;

  /**
   * Total milliseconds of penalty-free DEFERRAL this job has been granted
   * (#2613/#2617). A deferral consumes no retry attempt, so this running total
   * is the only thing that can end an otherwise endless defer cycle: past the
   * runner's budget the job rejoins the ordinary retry ladder and can reach
   * `dead`. `null` for a job that has never been deferred.
   */
  @Column({ type: 'integer', nullable: true })
  deferredTotalMs!: number | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

