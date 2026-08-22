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
import type { OrderSyncStatusFilter } from '../../../domain/types/order-record.types';

/**
 * Sync status JSONB structure
 */
export interface OrderSyncStatusJson {
  destinationConnectionId: string;
  status: OrderSyncStatusFilter;
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
  status: OrderSyncStatusFilter;
  attemptedAt: string;
  error?: string;
  externalOrderId?: string;
  externalOrderNumber?: string;
}

@Entity('order_records')
@Index(['customerId'])
@Index(['sourceConnectionId'])
@Index(['createdAt'])
// Reporting-currency analytics shape (#2124): filter by connection, group by
// reporting currency. PARTIAL, and composite rather than a standalone index on
// `reportingCurrency` — that column carries 1-3 distinct values, so a
// single-column btree is not selective enough for the planner to prefer over a
// sequential scan, and `@Index(['sourceConnectionId'])` above already covers
// the filter half. The predicate keeps every unstamped row out of the index.
@Index('IDX_order_records_reporting', ['sourceConnectionId', 'reportingCurrency'], {
  where: '"reportingCurrency" IS NOT NULL',
})
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
   * The `default` is load-bearing, not cosmetic - do not delete it as a
   * tidy-up. Since #2140 the upsert omits this column from its write set, so
   * every insert relies on the column's own default; and a schema built by
   * TypeORM `synchronize` rather than by migrations gets that default from
   * here and nowhere else (`libs/shared/src/database/database.module.ts`
   * enables synchronize for every `NODE_ENV !== 'production'`, which is what
   * the integration harness runs on). Without it the first `persistOrder`
   * against such a schema violates the NOT NULL constraint.
   *
   * It mirrors the `NOT NULL DEFAULT '[]'` on the migration-built schema,
   * asserted by `1833000000005-set-order-records-sync-status-default.ts`
   * because the creating migration applies it only conditionally.
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

  /**
   * Neutral `SalesDocumentGateBlockReason` naming why no fiscal document was
   * issued (#2100, ADR-041 decision 11). `null` = nothing blocking. Indexed
   * because it IS a filter axis (the orders list ships an "Invoicing blocked"
   * chip and a `salesDocumentBlocked` count) — unlike `mappingFailureReason`,
   * which is free text and never filtered on.
   *
   * Plain `varchar` with no check constraint, matching `recordStatus`: the union
   * is enforced in TypeScript, and a future ADR-041 value must not need DDL.
   */
  @Column({ type: 'varchar', nullable: true })
  @Index()
  salesDocumentBlockReason!: string | null;

  /**
   * The `SalesDocumentUnresolvedReason` paired with a `'unresolved-routing'`
   * block (ADR-041 §107); `null` for every other reason. Not indexed — the
   * filter axis is "is this order blocked at all", which the column above
   * answers; this one only refines the copy.
   */
  @Column({ type: 'varchar', nullable: true })
  salesDocumentUnresolvedReason!: string | null;

  /**
   * PII-free elaboration of the reason above (ids and counts only). Free text,
   * rendered verbatim to the operator, never filtered on — so no index, same
   * call as `mappingFailureReason`.
   */
  @Column({ type: 'text', nullable: true })
  salesDocumentBlockDetail!: string | null;

  /**
   * Per-order reporting-currency snapshot (#2124, ADR-040) — six columns
   * written ONLY by the two narrow, conditional UPDATEs on the repository
   * (`claimFxIntentIfAbsent`, `stampFxIfAbsent`). The ingestion upsert
   * deliberately omits all six (see the `toOrm` comments): `upsert` is a
   * full-row `save()` and a re-ingestion would otherwise write `null` over an
   * already-reported financial figure.
   *
   * The migration guards the group with `ck_order_records_fx_group` so the
   * columns cannot drift into a meaningless combination.
   */

  /**
   * ISO-4217 currency `reportingTotalAmount` is expressed in. `NULL` is the
   * canonical "unstamped" test — NOT `exchangeRateId IS NULL`, which is
   * legitimately NULL on the same-currency path and would discard the
   * overwhelming majority of orders.
   */
  @Column({ type: 'varchar', length: 3, nullable: true })
  reportingCurrency!: string | null;

  /** The order total converted into `reportingCurrency`, rounded to 2dp. */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  reportingTotalAmount!: number | null;

  /**
   * `exchange_rates.id` the conversion used; `NULL` when the order's own
   * currency already equalled the reporting currency, so no rate was needed.
   * Deliberately carries NO foreign key and NO index: `order_records` has zero
   * FKs today, and the analytics join lands on `exchange_rates`' own PK, so an
   * index on the referencing side buys nothing for that direction.
   */
  @Column({ type: 'uuid', nullable: true })
  exchangeRateId!: string | null;

  /**
   * Which published day's rate the stamp was taken against (`FxRateRule`).
   * Kept a bare `string` on the read side so a value written by a newer
   * deployment surfaces as-is instead of being coerced or dropped. Written by
   * the intent claim as well as the stamp, which is why the group CHECK's
   * "unstamped" arm deliberately does NOT require it to be NULL.
   */
  @Column({ type: 'varchar', length: 32, nullable: true })
  fxRule!: string | null;

  /**
   * Instant the stamp attempt reached a terminal answer. NULL on a row still
   * awaiting the retry job, so `fxStampedAt IS NULL` alone does not mean
   * "unstampable" — the sweep predicate uses it together with
   * `reportingCurrency IS NULL`.
   */
  @Column({ type: 'timestamptz', nullable: true })
  fxStampedAt!: Date | null;

  /**
   * The reporting currency pinned at the FIRST stamp attempt (ADR-040
   * § Decision 5), claimed before any rate lookup. Deliberately a separate
   * column from `reportingCurrency`: the two differ in meaning (*intended* vs
   * *stamped*) and in lifecycle (an intent exists on a row that is still
   * unstamped), and collapsing them would make the stamp guard's `IsNull()`
   * predicate unusable.
   */
  @Column({ type: 'varchar', length: 3, nullable: true })
  fxIntendedCurrency!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
