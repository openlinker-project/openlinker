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

  @Column({ type: 'varchar', unique: true })
  idempotencyKey!: string;

  @Column({ default: 0 })
  attempts!: number;

  @Column({ default: 10 })
  maxAttempts!: number;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  nextRunAt!: Date;

  @Column({ type: 'timestamp', nullable: true })
  lockedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true })
  lockedBy!: string | null;

  @Column({ type: 'text', nullable: true })
  lastError!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

