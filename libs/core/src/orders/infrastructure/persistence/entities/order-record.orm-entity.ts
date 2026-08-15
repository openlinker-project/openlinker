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
   * Tracks sync state for each destination connection.
   *
   * The `default` mirrors the `NOT NULL DEFAULT '[]'` the creating migration
   * already put on the column. It was missing here, so the reliance on that DB
   * default was incidental rather than declared once the upsert stopped writing
   * the column (#2140) - and metadata that omits a default reads as schema drift
   * to `migration:generate`.
   */
  @Column({ type: 'jsonb', default: () => "'[]'" })
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
   * Operator-facing reason item resolution failed at ingestion (#1689) —
   * `recordStatus = 'awaiting_mapping' | 'source_deleted'`. `null` for a
   * `'ready'` record or a historical row predating the column.
   */
  @Column({ type: 'text', nullable: true })
  mappingFailureReason!: string | null;

  /**
   * Instant the source reported this order cancelled (#1984). `null` = never
   * cancelled (or a historical row the backfill migration could not derive a
   * proxy timestamp for). Independent of `recordStatus`. Indexed for the
   * future exclusion predicate (#1987/#1988: `WHERE "cancelledAt" IS NULL`).
   */
  @Column({ type: 'timestamptz', nullable: true })
  @Index()
  cancelledAt!: Date | null;

  /**
   * Derived marketplace dispatch (ship-by) deadline (#927) — the `.to` of the
   * source dispatch window, denormalized from the snapshot so the orders list
   * can sort/filter on the SLA via an index without parsing JSONB. `null` when
   * the source exposes no dispatch SLA (non-marketplace orders, older records).
   */
  @Column({ type: 'timestamptz', nullable: true })
  @Index()
  dispatchByAt!: Date | null;

  /**
   * Per-order fulfillment rollup (#1108) — denormalized projection of the
   * order's shipment lifecycle (`not-shipped | dispatched | delivered |
   * failed`), pushed from the shipping context. Indexed so the orders list can
   * filter/sort on it. NULL ≡ `not-shipped` (column ships nullable; no
   * backfill — orders converge on the next shipment mutation / reconcile poll).
   */
  @Column({ type: 'varchar', nullable: true })
  @Index()
  fulfillmentState!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
