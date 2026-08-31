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
import type { OrderAmendmentChange } from '../../../domain/order-amendment-diff';
import type { AuthorityAttentionEntry } from '@openlinker/core/fulfillment-authority';

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
   * When the CURRENT hold started (#2248 / #2245 F4).
   *
   * The reason column is level-triggered and nulled the moment it clears, so
   * without an instant there is no clock for the operator-facing age and no
   * "held since" to render. Stamped on the `none -> blocked` transition only,
   * so a change of reason inside one episode does not reset an age somebody is
   * watching, and written exclusively by `updateSalesDocumentBlock` - never by
   * the ingestion upsert.
   */
  @Column({ type: 'timestamptz', nullable: true })
  salesDocumentBlockedAt!: Date | null;

  /**
   * When the current hold ENDED. Stamped on `blocked -> none` and cleared
   * whenever a new block starts, so the pair always describes one episode.
   *
   * It is what makes the "the rate arrived, the invoice issued" timeline entry
   * possible: the reason itself is gone by then, so nothing else records that
   * the order was ever held.
   */
  @Column({ type: 'timestamptz', nullable: true })
  salesDocumentBlockReleasedAt!: Date | null;

  /**
   * Marks an order that arrived BEFORE per-line tax rates existed (#2256).
   *
   * `'pre-rollout'` on every row the enabling migration found; `null` on
   * everything ingested afterwards. It is a DATA marker for analytics, not an
   * operator-facing state - such an order issues exactly as it does today, and
   * the frontend deliberately renders nothing for it.
   *
   * Its only job is to keep a net-revenue figure honest: a pre-rollout order's
   * tax was whatever the provider defaulted to, so presenting it as a confirmed
   * rate would be a claim the data does not support. Excluded rather than
   * back-computed, because there is nothing to compute from.
   *
   * Recorded per RECORD rather than per line, deliberately. The lines live in a
   * jsonb snapshot, so a per-line marker would mean rewriting every snapshot in
   * the table for a value that is uniform across an order and that no surface
   * renders per line.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  taxRateEra!: string | null;

  /**
   * Order analytics read-model scalars (#1985), denormalized from `orderSnapshot`
   * at `persistOrder` time — see ADR-039 for the persistence-strategy decision.
   * `placedAt`/`currency` are indexed (the two access patterns the analytics
   * aggregates need: date-range + channel filtering); `taxTreatment`/`totalAmount`
   * are not, since neither is filtered on directly today.
   */
  @Column({ type: 'timestamptz', nullable: true })
  @Index()
  placedAt!: Date | null;

  @Column({ type: 'varchar', length: 3, nullable: true })
  @Index()
  currency!: string | null;

  /** `null` = "not asserted by the source" (#1985 [G]) — never defaulted by a consumer. */
  @Column({ type: 'varchar', nullable: true })
  taxTreatment!: string | null;

  // decimal (not numeric) to match the house convention on money columns
  // (products.price, product_variants.price) — pg returns this as a string
  // at the driver level; the repository's toDomain explicitly Number()s it,
  // mirroring ProductRepository's existing price-column handling.
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  totalAmount!: number | null;

  /**
   * Buyer tax identifier as the source reported it (#2599), denormalized off
   * the snapshot's billing address so a routing or gating query never has to
   * expand JSONB - and so the value survives `OL_STORE_PII=false`, under which
   * the snapshot address is replaced by `[REDACTED]`.
   *
   * THREE states in one column, and a bare `IS NOT NULL` reads the middle one
   * wrong: `NULL` = the source asserted nothing, `''` = the source asserted the
   * buyer has none, otherwise the id. Round-trip it through
   * `encodeBuyerTaxIdColumn` / `decodeBuyerTaxIdColumn`.
   *
   * Written only on the `'ready'` path (`upsertWithLineItems`), like the four
   * analytics scalars above: the awaiting-mapping snapshot has no resolved
   * order to read a billing address off yet.
   *
   * PII-gated at persistence. For a sole trader the tax id identifies a natural
   * person, so hash-only mode stores nothing rather than keeping the one buyer
   * identifier that survived the address redaction.
   */
  @Column({ type: 'text', nullable: true })
  buyerTaxId!: string | null;

  /**
   * Stable hash of the order's shipping address (#2395), stamped at ingestion
   * from the LIVE, un-redacted address - so it survives `OL_STORE_PII=false`,
   * under which the snapshot address is replaced by `[REDACTED]` and hashing
   * it back would yield one hash per country shared by every order.
   *
   * Written only on the `'ready'` path (`upsertWithLineItems`), like the four
   * analytics scalars and `buyerTaxId` above: an `awaiting_mapping`
   * re-ingestion routed through the shared `toOrm` would NULL a hash a
   * previous ready-path write settled.
   *
   * NOT PII-gated, unlike its `buyerTaxId` neighbour: it is a one-way hash
   * carrying no recoverable address, and gating it would remove it precisely
   * on the hash-only deployments that need it.
   */
  @Column({ type: 'text', nullable: true })
  shippingAddressHash!: string | null;

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

  /**
   * Instant an operator marked this order packed (#2287). `null` = not packed.
   * A fact, not a state — independent of `recordStatus` / `fulfillmentState` /
   * `slaState`. Indexed because "is it packed" is an operator-facing scan axis,
   * mirroring `cancelledAt`.
   */
  @Column({ type: 'timestamptz', nullable: true })
  @Index()
  packedAt!: Date | null;

  /**
   * OL user id of whoever marked this order packed (#2287). Deliberately
   * unindexed: it is display + attribution only and is never filtered on. No FK
   * to `users` — this table FKs across no context, and a dangling id from a
   * deleted user is the honest outcome for an audit fact.
   */
  @Column({ type: 'uuid', nullable: true })
  packedByUserId!: string | null;

  /**
   * Instant OpenLinker last observed the source amend this order after ingestion
   * (#2283). `null` = never observed amended. Indexed because "which orders did
   * the source change under us" is an operator-facing scan axis, and it is the
   * index that makes a follow-up list badge/filter cheap. Plain rather than
   * partial, mirroring `packedAt`: an operator filters both ways.
   */
  @Column({ type: 'timestamptz', nullable: true })
  @Index()
  lastAmendedAt!: Date | null;

  /**
   * The change list observed at `lastAmendedAt` (#2283) — most recent
   * observation only, not a history. `jsonb` because the shape is a small
   * open-ended list the FE renders; nothing queries inside it. PII-free by
   * construction (ids, SKUs, quantities and address FIELD NAMES only).
   */
  @Column({ type: 'jsonb', nullable: true })
  lastAmendmentChanges!: OrderAmendmentChange[] | null;

  /**
   * Denormalised reason of the order's currently-open hold (#2340), or `null`
   * when nothing holds it.
   *
   * **`order_holds` is the authority; this column is a CACHE.** It exists so the
   * derived-lifecycle `CASE` (#2309) and the `?phase=held` filter can answer
   * without joining `order_holds` per bucket — that `CASE` is already
   * non-sargable and `getManyAndCount()` evaluates it twice per request. On
   * drift the table wins and `orders.holds.reconcile` repairs the column; no
   * hold GATE may read it (the epic's L4 exit criterion).
   *
   * Written ONLY by `OrderHoldProjectionRepositoryPort.setActiveHoldReason`,
   * and deliberately excluded from `toOrm` + `upsert`'s column tuple — the
   * `cancelledAt` / `salesDocument*` single-writer precedent.
   *
   * Plain `text` with no check constraint, matching `salesDocumentBlockReason`:
   * the union is enforced in TypeScript, and `isHoldReason` coerces on read.
   */
  @Column({ type: 'text', nullable: true })
  @Index('IDX_order_records_active_hold', { where: '"activeHoldReason" IS NOT NULL' })
  activeHoldReason!: string | null;

  /**
   * The OMS inert states currently reported against this order (#2352,
   * Wave-2 product spec §4.2) — an array of `AuthorityAttentionEntry`, or NULL
   * when nothing is reported.
   *
   * **An ARRAY keyed by producer, not a scalar reason, and that is the whole
   * point.** #2100's single `salesDocumentBlockReason` is safe because ONE
   * authority re-decides the whole question on every order transition, so its
   * `null` is a complete statement. Here the writers are three unrelated
   * subsystems (the reservation ledger, routing, the execution handshake) and an
   * order can genuinely carry two states at once — one line unroutable, another
   * short. A level-triggered scalar would make each producer's "nothing is
   * wrong" honest about its own question and a lie about the others', so the
   * `Needs attention (N)` count would depend on which subsystem ran last.
   * `updateOmsAttention` therefore replaces or removes exactly ONE producer's
   * entry and leaves the rest alone.
   *
   * Sole writer `updateOmsAttention` — deliberately NOT round-tripped through
   * `toOrm`, for the reason the three `salesDocument*` columns are not.
   *
   * **No index, deliberately.** Nothing writes this column yet (its producers
   * are Wave-3 / the reservation-ledger and returns-custody bodies), so an index
   * added here would be permanently empty DDL sized against no real cardinality;
   * and a partial index over a hardcoded value list is exactly the shape that
   * silently went stale on `IDX_order_records_salesDocumentBlockReason` when
   * #2248 widened the union without touching the index. The producing issue adds
   * it, against its own data.
   */
  @Column({ type: 'jsonb', nullable: true })
  omsAttention!: AuthorityAttentionEntry[] | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
