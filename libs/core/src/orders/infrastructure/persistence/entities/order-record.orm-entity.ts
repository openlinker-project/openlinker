/**
 * Order Record ORM Entity
 *
 * TypeORM entity representing the order_records table in PostgreSQL.
 * Stores minimal order data (OrderRecord + SyncState) for retry/debug support
 * without re-polling source systems. Order snapshot is JSONB and PII-aware.
 *
 * @module libs/core/src/orders/infrastructure/persistence/entities
 */
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

/**
 * Sync status JSONB structure
 */
export interface OrderSyncStatusJson {
  destinationConnectionId: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  syncedAt?: string;
  externalOrderId?: string;
  externalOrderNumber?: string;
  error?: string;
}

/**
 * Sync attempt JSONB structure (append-only history per destination).
 * `attemptedAt` is ISO 8601; the domain entity exposes it as a `Date`.
 */
export interface SyncAttemptJson {
  destinationConnectionId: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  attemptedAt: string;
  error?: string;
  externalOrderId?: string;
  externalOrderNumber?: string;
}

@Entity('order_records')
@Index(['customerId'])
@Index(['sourceConnectionId'])
@Index(['createdAt'])
export class OrderRecordOrmEntity {
  @PrimaryColumn({ type: 'text' })
  internalOrderId!: string;

  @Column({ type: 'text', nullable: true })
  customerId!: string | null;

  @Column({ type: 'uuid' })
  sourceConnectionId!: string;

  @Column({ type: 'varchar', nullable: true })
  sourceEventId!: string | null;

  /**
   * Order snapshot (JSONB, PII-aware)
   * Contains full order data, but PII fields may be nulled/hashed based on OL_STORE_PII
   */
  @Column({ type: 'jsonb' })
  orderSnapshot!: Record<string, unknown>;

  /**
   * Sync status per destination (JSONB array)
   * Tracks sync state for each destination connection
   */
  @Column({ type: 'jsonb' })
  syncStatus!: OrderSyncStatusJson[];

  /**
   * Append-only attempt log per destination (JSONB array, capped per
   * destination by the repository UPDATE statement). Enables the activity
   * timeline to render `failed → retried → synced` history.
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  syncAttempts!: SyncAttemptJson[];

  @Column({ type: 'varchar', default: 'ready' })
  @Index()
  recordStatus!: string;

  /**
   * Derived marketplace dispatch (ship-by) deadline (#927) — the `.to` of the
   * source dispatch window, denormalized from the snapshot so the orders list
   * can sort/filter on the SLA via an index without parsing JSONB. `null` when
   * the source exposes no dispatch SLA (non-marketplace orders, older records).
   */
  @Column({ type: 'timestamptz', nullable: true })
  @Index()
  dispatchByAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
