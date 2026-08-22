/**
 * Order Record Repository
 *
 * Repository implementation for order record persistence operations.
 * Provides data access methods for finding and upserting order records,
 * with conversion between domain entities and ORM entities.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 * @implements {OrderRecordRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { In, IsNull, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import type { OrderSyncStatusJson, SyncAttemptJson } from '../entities/order-record.orm-entity';
import { OrderRecordOrmEntity } from '../entities/order-record.orm-entity';
import type { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import { OrderRecord } from '../../../domain/entities/order-record.entity';
import type { OrderSyncStatus, SyncAttempt } from '../../../domain/types/order-sync.types';
import { SYNC_ATTEMPTS_PER_DESTINATION_CAP } from '../../../domain/types/order-sync.types';
import { OrderRecordNotFoundException } from '../../../domain/exceptions/order-record-not-found.exception';
import type {
  OrderRecordFilters,
  OrderRecordPagination,
  PaginatedOrderRecords,
  OrderRecordStatus,
  OrderHealth,
  OrderHealthSummary,
  OrderHealthSummaryFilters,
  OrderRecordSort,
  OrderRecordSortDirection,
  FailedSyncValueSummary,
} from '../../../domain/types/order-record.types';
import type { SlaState, OrderSlaSummary } from '../../../domain/types/order-sla.types';
import { SLA_AT_RISK_WINDOW_MS } from '../../../domain/types/order-sla.types';
import type { FulfillmentRollupState } from '../../../domain/types/order-fulfillment.types';
import type { SalesDocumentBlock } from '@openlinker/core/sales-documents';
import {
  SalesDocumentAttentionReasonValues,
  isSalesDocumentGateBlockReason,
  isSalesDocumentUnresolvedReason,
} from '@openlinker/core/sales-documents';
import type { OrderFxIntent, OrderFxStamp } from '../../../domain/types/order-fx.types';
import type { StampedReportingCurrencyCount } from '../../../domain/types/order-fx-read.types';

@Injectable()
export class OrderRecordRepository implements OrderRecordRepositoryPort {
  constructor(
    @InjectRepository(OrderRecordOrmEntity)
    private readonly repository: Repository<OrderRecordOrmEntity>
  ) {}

  async findById(internalOrderId: string): Promise<OrderRecord | null> {
    const entity = await this.repository.findOne({
      where: { internalOrderId },
    });

    if (!entity) {
      return null;
    }

    return this.toDomain(entity);
  }

  /**
   * Batch-find by internal order ID (#1995) — single `IN (...)` query, no
   * pagination. Ids with no matching row are simply absent from the result.
   */
  async findByIds(internalOrderIds: string[]): Promise<OrderRecord[]> {
    if (internalOrderIds.length === 0) {
      return [];
    }
    const entities = await this.repository.find({
      where: { internalOrderId: In(internalOrderIds) },
    });
    return entities.map((e) => this.toDomain(e));
  }

  async findMany(
    filters: OrderRecordFilters,
    pagination: OrderRecordPagination
  ): Promise<PaginatedOrderRecords> {
    const qb: SelectQueryBuilder<OrderRecordOrmEntity> = this.repository
      .createQueryBuilder('rec')
      .take(pagination.limit)
      .skip(pagination.offset);

    if (filters.sourceConnectionId) {
      qb.andWhere('rec.sourceConnectionId = :sourceConnectionId', {
        sourceConnectionId: filters.sourceConnectionId,
      });
    }

    if (filters.customerId) {
      qb.andWhere('rec.customerId = :customerId', {
        customerId: filters.customerId,
      });
    }

    if (filters.createdFrom) {
      qb.andWhere('rec.createdAt >= :createdFrom', {
        createdFrom: filters.createdFrom,
      });
    }

    if (filters.createdTo) {
      qb.andWhere('rec.createdAt <= :createdTo', {
        createdTo: filters.createdTo,
      });
    }

    if (filters.syncStatus) {
      // JSONB containment: find orders where any destination has this status
      // 'order' is a reserved word in PostgreSQL so the alias is 'rec'
      qb.andWhere(`rec."syncStatus" @> :syncStatusFilter::jsonb`, {
        syncStatusFilter: JSON.stringify([{ status: filters.syncStatus }]),
      });
    }

    if (filters.recordStatus) {
      qb.andWhere('rec.recordStatus = :recordStatus', { recordStatus: filters.recordStatus });
    }

    if (filters.destinationConnectionId) {
      // JSONB containment — match records whose `syncStatus[]` contains an
      // entry with this destinationConnectionId (#834). Same idiom as the
      // `syncStatus` enum filter above. No GIN index today — acceptable at
      // v1 scale (≤30k rows in the typical 30-day window), file a follow-up
      // if scan time creeps.
      qb.andWhere(`rec."syncStatus" @> :destFilter::jsonb`, {
        destFilter: JSON.stringify([
          { destinationConnectionId: filters.destinationConnectionId },
        ]),
      });
    }

    if (filters.updatedSince) {
      qb.andWhere('rec.updatedAt >= :updatedSince', { updatedSince: filters.updatedSince });
    }

    if (filters.dueBefore) {
      // SLA "breaching / overdue" filter (#927) — only records with a known
      // ship-by deadline at or before the cutoff. NULL deadlines are excluded.
      qb.andWhere('rec.dispatchByAt IS NOT NULL AND rec.dispatchByAt <= :dueBefore', {
        dueBefore: filters.dueBefore,
      });
    }

    if (filters.health) {
      this.applyHealthFilter(qb, filters.health);
    }

    if (filters.fulfillmentState) {
      this.applyFulfillmentFilter(qb, filters.fulfillmentState);
    }

    if (filters.slaState) {
      this.applySlaFilter(qb, filters.slaState);
    }

    if (filters.cancelled !== undefined) {
      // #1984 — queryable without parsing orderSnapshot. `undefined` means
      // "don't filter"; both `true` and `false` are meaningful predicates.
      qb.andWhere(filters.cancelled ? 'rec.cancelledAt IS NOT NULL' : 'rec.cancelledAt IS NULL');
    }

    if (filters.salesDocumentBlocked !== undefined) {
      // #2100 — an independent axis, deliberately ANDed with `health` rather than
      // folded into it: "synced AND invoicing blocked" is the most common shape of
      // the problem this issue exists to surface.
      qb.andWhere(
        filters.salesDocumentBlocked
          ? OrderRecordRepository.IS_SALES_DOCUMENT_BLOCKED
          : `NOT (${OrderRecordRepository.IS_SALES_DOCUMENT_BLOCKED})`,
      );
    }

    this.applySort(qb, filters.sort, filters.dir);

    const [entities, total] = await qb.getManyAndCount();

    return {
      items: entities.map((e) => this.toDomain(e)),
      total,
    };
  }

  /**
   * Derived-health count summary (#929).
   *
   * One aggregate query partitioning every in-scope record into exactly one
   * bucket via `COUNT(*) FILTER (...)`. The bucket predicates encode the
   * canonical precedence documented on `OrderHealthValues` — and are the SQL
   * twin of the FE `deriveOrderHealth` helper; keep both in lockstep.
   *
   * No GIN index on `syncStatus` today — full scan is acceptable at v1 scale
   * (same trade-off noted on the `findMany` JSONB filters); revisit with an
   * index if scan time creeps.
   */
  async countByHealth(filters: OrderHealthSummaryFilters): Promise<OrderHealthSummary> {
    const notMappingOrDeleted = OrderRecordRepository.NOT_MAPPING_OR_DELETED;
    const qb = this.repository
      .createQueryBuilder('rec')
      .select('COUNT(*)', 'total')
      .addSelect(
        `COUNT(*) FILTER (WHERE ${OrderRecordRepository.IS_SOURCE_DELETED})`,
        'source_deleted'
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE NOT (${OrderRecordRepository.IS_SOURCE_DELETED}) AND ${OrderRecordRepository.IS_MAPPING})`,
        'awaiting_mapping'
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE ${notMappingOrDeleted} AND ${OrderRecordRepository.HAS_FAILED})`,
        'needs_attention'
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE ${notMappingOrDeleted} AND NOT (${OrderRecordRepository.HAS_FAILED}) AND ${OrderRecordRepository.HAS_SYNCED})`,
        'synced'
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE ${notMappingOrDeleted} AND NOT (${OrderRecordRepository.HAS_FAILED}) AND NOT (${OrderRecordRepository.HAS_SYNCED}))`,
        'awaiting_dispatch'
      )
      // #2100 — ORTHOGONAL to the five buckets above, not a sixth partition
      // member: this predicate deliberately carries no `notMappingOrDeleted`
      // guard, so a blocked order is counted here AND in whichever health bucket
      // it belongs to. `total` still equals the sum of the five.
      .addSelect(
        `COUNT(*) FILTER (WHERE ${OrderRecordRepository.IS_SALES_DOCUMENT_BLOCKED})`,
        'sales_document_blocked'
      );

    if (filters.sourceConnectionId) {
      qb.andWhere('rec.sourceConnectionId = :sourceConnectionId', {
        sourceConnectionId: filters.sourceConnectionId,
      });
    }
    if (filters.customerId) {
      qb.andWhere('rec.customerId = :customerId', { customerId: filters.customerId });
    }
    if (filters.createdFrom) {
      qb.andWhere('rec.createdAt >= :createdFrom', { createdFrom: filters.createdFrom });
    }
    if (filters.createdTo) {
      qb.andWhere('rec.createdAt <= :createdTo', { createdTo: filters.createdTo });
    }

    const raw = await qb.getRawOne<{
      total: string;
      source_deleted: string;
      awaiting_mapping: string;
      needs_attention: string;
      synced: string;
      awaiting_dispatch: string;
      sales_document_blocked: string;
    }>();

    return {
      total: Number(raw?.total ?? 0),
      sourceDeleted: Number(raw?.source_deleted ?? 0),
      awaitingMapping: Number(raw?.awaiting_mapping ?? 0),
      needsAttention: Number(raw?.needs_attention ?? 0),
      synced: Number(raw?.synced ?? 0),
      awaitingDispatch: Number(raw?.awaiting_dispatch ?? 0),
      salesDocumentBlocked: Number(raw?.sales_document_blocked ?? 0),
    };
  }

  async getFailedSyncValueSummary(
    filters: OrderHealthSummaryFilters
  ): Promise<FailedSyncValueSummary> {
    const notMappingOrDeleted = OrderRecordRepository.NOT_MAPPING_OR_DELETED;
    const stuckPredicate = `${notMappingOrDeleted} AND ${OrderRecordRepository.HAS_FAILED}`;

    const qb = this.repository
      .createQueryBuilder('rec')
      .select(`COUNT(*) FILTER (WHERE ${stuckPredicate})`, 'count')
      .addSelect(
        `COALESCE(SUM(${OrderRecordRepository.TOTAL_EXPR}) FILTER (WHERE ${stuckPredicate}), 0)`,
        'total_value'
      )
      .addSelect(
        `COUNT(DISTINCT (rec."orderSnapshot"#>>'{totals,currency}')) FILTER (WHERE ${stuckPredicate})`,
        'currency_count'
      )
      .addSelect(
        `MIN(${OrderRecordRepository.OLDEST_FAILED_ATTEMPT_AT_EXPR}) FILTER (WHERE ${stuckPredicate})`,
        'oldest_failed_at'
      );

    if (filters.sourceConnectionId) {
      qb.andWhere('rec.sourceConnectionId = :sourceConnectionId', {
        sourceConnectionId: filters.sourceConnectionId,
      });
    }
    if (filters.customerId) {
      qb.andWhere('rec.customerId = :customerId', { customerId: filters.customerId });
    }
    if (filters.createdFrom) {
      qb.andWhere('rec.createdAt >= :createdFrom', { createdFrom: filters.createdFrom });
    }
    if (filters.createdTo) {
      qb.andWhere('rec.createdAt <= :createdTo', { createdTo: filters.createdTo });
    }

    const raw = await qb.getRawOne<{
      count: string;
      total_value: string;
      currency_count: string;
      oldest_failed_at: Date | null;
    }>();

    return {
      count: Number(raw?.count ?? 0),
      totalValue: Number(raw?.total_value ?? 0),
      mixedCurrency: Number(raw?.currency_count ?? 0) > 1,
      oldestFailedAt: raw?.oldest_failed_at ?? null,
    };
  }

  /**
   * Constant SQL fragments shared by `applyHealthFilter` and `countByHealth`
   * (no user input). `HAS_*` use `@>` containment — matches when `syncStatus[]`
   * contains an entry with the given status; `IS_SOURCE_DELETED` keys the
   * highest-precedence bucket, `IS_MAPPING` the second. The three
   * non-mapping/non-deleted buckets gate on `NOT_MAPPING_OR_DELETED` (residual
   * form) rather than `recordStatus = 'ready'`, so the five buckets remain a
   * complete partition for ANY `recordStatus` value — adding a further status
   * later can't silently leave rows uncounted. This mirrors the FE
   * `deriveOrderHealth` precedence (source_deleted → mapping → failed → synced
   * → else) exactly.
   */
  private static readonly IS_SOURCE_DELETED = `rec."recordStatus" = 'source_deleted'`;
  private static readonly IS_MAPPING = `rec."recordStatus" = 'awaiting_mapping'`;
  private static readonly NOT_MAPPING_OR_DELETED =
    `NOT (${OrderRecordRepository.IS_MAPPING}) AND NOT (${OrderRecordRepository.IS_SOURCE_DELETED})`;
  private static readonly HAS_FAILED = `rec."syncStatus" @> '[{"status":"failed"}]'::jsonb`;
  private static readonly HAS_SYNCED = `rec."syncStatus" @> '[{"status":"synced"}]'::jsonb`;
  /**
   * #2100 — NOT part of the health partition. Deliberately kept out of the
   * `IS_*` bucket set above so it can never be pasted into `applyHealthFilter`
   * or `countByHealth`'s FILTER clauses by mistake: an invoicing block is
   * orthogonal to sync health and is counted alongside the five, never among
   * them. Uses the indexed `salesDocumentBlockReason` column.
   *
   * An explicit IN-list of ATTENTION-WORTHY reasons rather than `IS NOT NULL`
   * (#2100 review), which fixes two problems at once:
   *
   * - `'trigger-model-manual'` is excluded. It is `parseTriggerModel`'s default,
   *   so on a manual install every uninvoiced order carries it — `IS NOT NULL`
   *   would put a red "Invoicing blocked 4,312" on a perfectly healthy install.
   *   The per-order badge still renders manual, neutral; it is just never
   *   aggregated or filtered on.
   * - A reason string this build does not recognise (written by a newer release,
   *   then rolled back) no longer matches. `toDomain` already coerces such a value
   *   to `null` on read, so `IS NOT NULL` counted rows that then rendered no badge
   *   anywhere — a count with no reachable explanation.
   *
   * Built from `SalesDocumentAttentionReasonValues`, so a reason added to ADR-041's
   * union is attention-worthy by default. Literal-only (no user input) — the values
   * are compile-time constants, never request data.
   *
   * `COALESCE(…, '')` is NOT cosmetic — it is what makes the NEGATION total.
   * `NULL IN (…)` evaluates to NULL, so `NOT (NULL IN (…))` is NULL and `WHERE`
   * DROPS the row: a bare IN-list made `salesDocumentBlocked=false` return zero
   * orders on an install where nothing is blocked, instead of all of them. The old
   * `IS NOT NULL` predicate was NULL-safe by construction and hid this trap when
   * the IN-list replaced it. Coalescing to the empty string (never a valid reason)
   * keeps both directions two-valued.
   */
  private static readonly IS_SALES_DOCUMENT_BLOCKED = `COALESCE(rec."salesDocumentBlockReason", '') IN (${SalesDocumentAttentionReasonValues.map(
    (reason) => `'${reason}'`,
  ).join(', ')})`;

  /**
   * Per-row earliest **failed sync attempt** timestamp, read from the
   * append-only `syncAttempts` history rather than `rec."createdAt"` (the
   * record's creation time, not a failure time) — `getFailedSyncValueSummary`'s
   * `oldestFailedAt` promises "the oldest failure", so it must reflect when a
   * sync attempt actually failed.
   */
  private static readonly OLDEST_FAILED_ATTEMPT_AT_EXPR = `(
    SELECT MIN((attempt->>'attemptedAt')::timestamptz)
    FROM jsonb_array_elements(rec."syncAttempts") AS attempt
    WHERE attempt->>'status' = 'failed'
  )`;

  /**
   * Triage-urgency ordinal for the `status` sort (#944): most-urgent first when
   * ascending. Mirrors the health precedence (source_deleted → mapping →
   * failed → synced → else) in WHEN order, but assigns the ordinal by urgency:
   * source_deleted(-1) < needs_attention(0) < awaiting_mapping(1) <
   * awaiting_dispatch(2) < synced(3). Existing ordinals (0–3) are left
   * unchanged so a pre-#1689 sort-order expectation on a non-deleted record
   * set doesn't shift.
   */
  private static readonly HEALTH_ORDINAL =
    `CASE WHEN ${OrderRecordRepository.IS_SOURCE_DELETED} THEN -1 ` +
    `WHEN ${OrderRecordRepository.IS_MAPPING} THEN 1 ` +
    `WHEN ${OrderRecordRepository.HAS_FAILED} THEN 0 ` +
    `WHEN ${OrderRecordRepository.HAS_SYNCED} THEN 3 ELSE 2 END`;

  /** JSONB ORDER-BY expressions for the derived sortable columns (#944). */
  // Guarded with `jsonb_typeof(...) = 'number'` (mirrors ITEMS_EXPR) so a
  // malformed / non-numeric `totals.total` sorts as NULL rather than throwing on
  // the `::numeric` cast and failing the whole list query. The migration's
  // expression index uses the identical form so the planner can still use it.
  private static readonly TOTAL_EXPR =
    `CASE WHEN jsonb_typeof(rec."orderSnapshot"#>'{totals,total}') = 'number' ` +
    `THEN (rec."orderSnapshot"#>>'{totals,total}')::numeric END`;
  private static readonly CUSTOMER_EXPR = `lower(rec."orderSnapshot"#>>'{shippingAddress,lastName}')`;
  // Guarded so a malformed (non-array) `items` value sorts as NULL rather than
  // erroring the whole list query.
  private static readonly ITEMS_EXPR =
    `CASE WHEN jsonb_typeof(rec."orderSnapshot"->'items') = 'array' ` +
    `THEN jsonb_array_length(rec."orderSnapshot"->'items') END`;
  // Top-level `paymentStatus` string (#1713). Sorts alphabetically
  // (awaiting < cod < paid < refunded), NULLs last — good enough to group by
  // payment state; a semantic ordinal isn't warranted for the current vocabulary.
  private static readonly PAYMENT_EXPR = `rec."orderSnapshot"->>'paymentStatus'`;

  /**
   * Apply result ordering (#927/#944). `dispatchBy` is the list's triage
   * default (soonest ship-by first, NULLs last); the JSONB-derived keys back the
   * sortable table columns. `dir` overrides the per-key default direction when
   * the FE supplies one (a header click). Every branch adds a stable
   * `createdAt DESC` tiebreaker so equal sort keys keep a deterministic order.
   */
  private applySort(
    qb: SelectQueryBuilder<OrderRecordOrmEntity>,
    sort: OrderRecordSort | undefined,
    dir: OrderRecordSortDirection | undefined
  ): void {
    const d = (fallback: 'ASC' | 'DESC'): 'ASC' | 'DESC' =>
      dir === 'asc' ? 'ASC' : dir === 'desc' ? 'DESC' : fallback;
    switch (sort) {
      case 'dispatchBy':
        qb.orderBy('rec.dispatchByAt', d('ASC'), 'NULLS LAST').addOrderBy('rec.createdAt', 'DESC');
        return;
      case 'total':
        qb.orderBy(OrderRecordRepository.TOTAL_EXPR, d('DESC'), 'NULLS LAST').addOrderBy(
          'rec.createdAt',
          'DESC'
        );
        return;
      case 'items':
        qb.orderBy(OrderRecordRepository.ITEMS_EXPR, d('DESC'), 'NULLS LAST').addOrderBy(
          'rec.createdAt',
          'DESC'
        );
        return;
      case 'customer':
        qb.orderBy(OrderRecordRepository.CUSTOMER_EXPR, d('ASC'), 'NULLS LAST').addOrderBy(
          'rec.createdAt',
          'DESC'
        );
        return;
      case 'status':
        qb.orderBy(OrderRecordRepository.HEALTH_ORDINAL, d('ASC')).addOrderBy(
          'rec.createdAt',
          'DESC'
        );
        return;
      case 'fulfillment':
        qb.orderBy(OrderRecordRepository.FULFILLMENT_ORDINAL, d('ASC')).addOrderBy(
          'rec.createdAt',
          'DESC'
        );
        return;
      case 'payment':
        qb.orderBy(OrderRecordRepository.PAYMENT_EXPR, d('ASC'), 'NULLS LAST').addOrderBy(
          'rec.createdAt',
          'DESC'
        );
        return;
      case 'createdAt':
      default:
        // No-sort default stays createdAt DESC (unchanged for non-list callers).
        qb.orderBy('rec.createdAt', d('DESC'));
        return;
    }
  }

  /**
   * Narrow a `findMany` query to a single derived-health bucket (#929).
   * Encodes the canonical precedence from `OrderHealthValues`; `awaiting_dispatch`
   * is the residual (everything not mapping / failed / synced).
   */
  private applyHealthFilter(
    qb: SelectQueryBuilder<OrderRecordOrmEntity>,
    health: OrderHealth
  ): void {
    const notMappingOrDeleted = OrderRecordRepository.NOT_MAPPING_OR_DELETED;
    switch (health) {
      case 'source_deleted':
        qb.andWhere(OrderRecordRepository.IS_SOURCE_DELETED);
        break;
      case 'awaiting_mapping':
        qb.andWhere(
          `NOT (${OrderRecordRepository.IS_SOURCE_DELETED}) AND ${OrderRecordRepository.IS_MAPPING}`
        );
        break;
      case 'needs_attention':
        qb.andWhere(`${notMappingOrDeleted} AND ${OrderRecordRepository.HAS_FAILED}`);
        break;
      case 'synced':
        qb.andWhere(
          `${notMappingOrDeleted} AND NOT (${OrderRecordRepository.HAS_FAILED}) AND ${OrderRecordRepository.HAS_SYNCED}`
        );
        break;
      case 'awaiting_dispatch':
        qb.andWhere(
          `${notMappingOrDeleted} AND NOT (${OrderRecordRepository.HAS_FAILED}) AND NOT (${OrderRecordRepository.HAS_SYNCED})`
        );
        break;
    }
  }

  /**
   * "Not shipped" guard (#1108): an order carries SLA pressure only while it
   * hasn't shipped. NULL `fulfillmentState` ≡ `not-shipped`, so it counts as not
   * shipped. Shared by the SLA filter + the SLA summary so the badge, filter,
   * and KPI all agree.
   */
  private static readonly NOT_SHIPPED =
    `(rec."fulfillmentState" IS NULL OR rec."fulfillmentState" NOT IN ('dispatched','delivered'))`;

  /**
   * Fulfillment-rollup sort ordinal (#1108) — most-actionable first when
   * ascending: failed(0) < not-shipped(1) < dispatched(2) < delivered(3).
   * NULL ≡ not-shipped(1).
   */
  private static readonly FULFILLMENT_ORDINAL =
    `CASE rec."fulfillmentState" WHEN 'failed' THEN 0 WHEN 'dispatched' THEN 2 ` +
    `WHEN 'delivered' THEN 3 ELSE 1 END`;

  /**
   * Narrow a `findMany` query to a single fulfillment-rollup value (#1108).
   * `not-shipped` also matches NULL (the documented NULL≡not-shipped rule).
   */
  private applyFulfillmentFilter(
    qb: SelectQueryBuilder<OrderRecordOrmEntity>,
    state: FulfillmentRollupState
  ): void {
    if (state === 'not-shipped') {
      qb.andWhere(`(rec."fulfillmentState" IS NULL OR rec."fulfillmentState" = 'not-shipped')`);
      return;
    }
    qb.andWhere(`rec."fulfillmentState" = :fulfillmentState`, { fulfillmentState: state });
  }

  /**
   * Narrow a `findMany` query to a single SLA bucket (#1108). Encodes the
   * {@link SlaState} precedence against the repository's server `now`, incl. the
   * "cleared once shipped" guard — the SQL twin of `deriveSlaState`; keep both
   * in lockstep. NULL deadlines / shipped orders are `none`.
   */
  private applySlaFilter(qb: SelectQueryBuilder<OrderRecordOrmEntity>, slaState: SlaState): void {
    const now = new Date();
    const riskCutoff = new Date(now.getTime() + SLA_AT_RISK_WINDOW_MS);
    const notShipped = OrderRecordRepository.NOT_SHIPPED;
    switch (slaState) {
      case 'none':
        qb.andWhere(`(NOT ${notShipped}) OR rec."dispatchByAt" IS NULL`);
        break;
      case 'overdue':
        qb.andWhere(`${notShipped} AND rec."dispatchByAt" IS NOT NULL AND rec."dispatchByAt" <= :slaNow`, {
          slaNow: now,
        });
        break;
      case 'at_risk':
        qb.andWhere(
          `${notShipped} AND rec."dispatchByAt" > :slaNow AND rec."dispatchByAt" <= :slaCutoff`,
          { slaNow: now, slaCutoff: riskCutoff }
        );
        break;
      case 'on_track':
        qb.andWhere(`${notShipped} AND rec."dispatchByAt" > :slaCutoff`, { slaCutoff: riskCutoff });
        break;
    }
  }

  /**
   * SLA-bucket count summary (#1108) for the list KPI strip — the SLA twin of
   * `countByHealth`. One aggregate query partitioning every in-scope record into
   * exactly one bucket via `COUNT(*) FILTER (...)`, encoding the same precedence
   * as `applySlaFilter` / `deriveSlaState`. `now` is the server clock.
   */
  async countBySla(filters: OrderHealthSummaryFilters): Promise<OrderSlaSummary> {
    // Per-query server clock. The list-row `slaState` (controller `toDto`) and
    // the `applySlaFilter` predicate each take their own `new Date()`, so a row
    // exactly on the at-risk boundary could bucket differently by milliseconds —
    // immaterial at the 24h window, and the same eventual-consistency posture as
    // the health summary. Thread a single `now` if exactness is ever required.
    const now = new Date();
    const riskCutoff = new Date(now.getTime() + SLA_AT_RISK_WINDOW_MS);
    const notShipped = OrderRecordRepository.NOT_SHIPPED;
    const qb = this.repository
      .createQueryBuilder('rec')
      .select('COUNT(*)', 'total')
      .addSelect(
        `COUNT(*) FILTER (WHERE ${notShipped} AND rec."dispatchByAt" IS NOT NULL AND rec."dispatchByAt" <= :slaNow)`,
        'overdue'
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE ${notShipped} AND rec."dispatchByAt" > :slaNow AND rec."dispatchByAt" <= :slaCutoff)`,
        'at_risk'
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE ${notShipped} AND rec."dispatchByAt" > :slaCutoff)`,
        'on_track'
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE (NOT ${notShipped}) OR rec."dispatchByAt" IS NULL)`,
        'none'
      )
      .setParameters({ slaNow: now, slaCutoff: riskCutoff });

    if (filters.sourceConnectionId) {
      qb.andWhere('rec.sourceConnectionId = :sourceConnectionId', {
        sourceConnectionId: filters.sourceConnectionId,
      });
    }
    if (filters.customerId) {
      qb.andWhere('rec.customerId = :customerId', { customerId: filters.customerId });
    }
    if (filters.createdFrom) {
      qb.andWhere('rec.createdAt >= :createdFrom', { createdFrom: filters.createdFrom });
    }
    if (filters.createdTo) {
      qb.andWhere('rec.createdAt <= :createdTo', { createdTo: filters.createdTo });
    }

    const raw = await qb.getRawOne<{
      total: string;
      on_track: string;
      at_risk: string;
      overdue: string;
      none: string;
    }>();

    return {
      total: Number(raw?.total ?? 0),
      onTrack: Number(raw?.on_track ?? 0),
      atRisk: Number(raw?.at_risk ?? 0),
      overdue: Number(raw?.overdue ?? 0),
      none: Number(raw?.none ?? 0),
    };
  }

  /**
   * Push a fulfillment-rollup value onto the order (#1108). Called from the
   * shipping context after any shipment-status mutation (best-effort projection).
   * Idempotent — sets the absolute value. No-op (no throw) when the order row
   * doesn't exist, so a shipment that references an order OL hasn't recorded
   * never fails the shipment op.
   */
  async updateFulfillmentState(
    internalOrderId: string,
    fulfillmentState: FulfillmentRollupState
  ): Promise<void> {
    await this.repository.update({ internalOrderId }, { fulfillmentState });
  }

  /**
   * Push the honest item-resolution-failure state onto the order record
   * (#1689). Narrow absolute-set on `recordStatus` + `mappingFailureReason`
   * only — no read-modify-write, so it can't race a concurrent write to any
   * other column on the same row (mirrors {@link updateFulfillmentState}).
   */
  async updateItemResolutionFailure(
    internalOrderId: string,
    input: { status: OrderRecordStatus; reason: string }
  ): Promise<void> {
    await this.repository.update(
      { internalOrderId },
      { recordStatus: input.status, mappingFailureReason: input.reason }
    );
  }

  /**
   * Durably record the instant this order was cancelled (#1984).
   * First-write-wins via `COALESCE` — a redelivered cancel event or a later
   * re-poll can never overwrite an already-recorded instant. Raw parameterized
   * query (mirrors {@link updateSyncStatus}'s idiom) because
   * `Repository.update()`'s partial-entity API cannot express a `COALESCE(...)`
   * right-hand side without an unsafe string-interpolated function value.
   * No-op (no throw, no rows affected) when the order row doesn't exist yet.
   */
  async markCancelled(internalOrderId: string, cancelledAt: Date): Promise<void> {
    await this.repository.query(
      `UPDATE "order_records"
       SET "cancelledAt" = COALESCE("cancelledAt", $1)
       WHERE "internalOrderId" = $2`,
      [cancelledAt, internalOrderId]
    );
  }

  /**
   * Set or clear the sales-document block (#2100). Narrow absolute-set on the three
   * `salesDocumentBlock*` columns only — no read-modify-write, so it can't race a
   * concurrent write to any other column on the same row (mirrors
   * {@link updateItemResolutionFailure}).
   *
   * Unlike {@link markCancelled}, this is deliberately last-write-wins rather than
   * first-write-wins: the gate re-decides on every transition, so the NEWEST answer
   * is the truthful one and an older reason must not survive it.
   */
  async updateSalesDocumentBlock(
    internalOrderId: string,
    block: SalesDocumentBlock | null
  ): Promise<void> {
    // The no-op guard lives HERE, in the WHERE clause, rather than in the caller
    // (#2100 review). A caller-side comparison had to hold a record it read before
    // the destination round-trip, so a concurrent writer — the manual-issue clear,
    // or the sibling ingestion path the `toOrm` comment already warns about — could
    // change the row in between and make a genuinely new answer look unchanged.
    // `IS DISTINCT FROM` is NULL-safe, so this is exact for the clear case too, and
    // it keeps the `@UpdateDateColumn` bump off the overwhelmingly common
    // `null -> null` path without giving up last-write-wins.
    await this.repository.query(
      `UPDATE "order_records"
          SET "salesDocumentBlockReason" = $1,
              "salesDocumentUnresolvedReason" = $2,
              "salesDocumentBlockDetail" = $3,
              "updatedAt" = now()
        WHERE "internalOrderId" = $4
          AND ("salesDocumentBlockReason" IS DISTINCT FROM $1
            OR "salesDocumentUnresolvedReason" IS DISTINCT FROM $2
            OR "salesDocumentBlockDetail" IS DISTINCT FROM $3)`,
      [
        block?.reason ?? null,
        block?.unresolvedReason ?? null,
        block?.detail ?? null,
        internalOrderId,
      ]
    );
  }

  /**
   * Claim the first-attempt FX intent (#2124). Conditional write — `IsNull()`
   * in the WHERE is what makes this atomic under two concurrent first attempts:
   * exactly one UPDATE can affect the row, and the loser adopts the winner's
   * intent rather than pinning a second currency for the same order. Mirrors
   * `ShipmentRepository.claimWaybillRelay`'s shape.
   */
  async claimFxIntentIfAbsent(internalOrderId: string, intent: OrderFxIntent): Promise<boolean> {
    const result = await this.repository.update(
      { internalOrderId, fxIntendedCurrency: IsNull() },
      { fxIntendedCurrency: intent.reportingCurrency, fxRule: intent.fxRule }
    );
    return (result.affected ?? 0) > 0;
  }

  /**
   * Stamp the reporting-currency figures at most once (#2124). All five stamp
   * columns move in ONE statement so the group can never half-apply, and the
   * `reportingCurrency: IsNull()` guard is what makes the write
   * stamp-once — a second attempt (retry job, sweep, redelivered event) affects
   * zero rows and leaves the already-reported figure untouched.
   *
   * The predicate is deliberately `reportingCurrency`, not
   * `fxIntendedCurrency`: the intent is claimed before the rate lookup, so it is
   * populated by the time any stamp is attempted.
   */
  async stampFxIfAbsent(internalOrderId: string, stamp: OrderFxStamp): Promise<boolean> {
    const result = await this.repository.update(
      { internalOrderId, reportingCurrency: IsNull() },
      {
        reportingCurrency: stamp.reportingCurrency,
        reportingTotalAmount: stamp.reportingTotalAmount,
        exchangeRateId: stamp.exchangeRateId,
        fxRule: stamp.fxRule,
        fxStampedAt: stamp.fxStampedAt,
      }
    );
    return (result.affected ?? 0) > 0;
  }

  /**
   * Distinct order-native currencies already ingested (#2124), for the
   * reporting-currency coverage advisory.
   *
   * Reads `orderSnapshot.totals.currency` because `order_records` carries no
   * native currency column yet (#1985 — deliberately not depended on); once it
   * does this collapses to `SELECT DISTINCT "currency" FROM "order_records"`.
   * The `jsonb_typeof(...) = 'string'` guard mirrors {@link TOTAL_EXPR}'s
   * numeric guard: a malformed value yields NULL and is filtered out rather
   * than failing the whole read, and the migration's expression index uses the
   * identical form so the planner can still use it.
   *
   * Quoted camelCase identifiers on purpose — no TypeORM `namingStrategy` is
   * configured anywhere in the repo, so `order_snapshot` would error at runtime.
   */
  async listDistinctNativeCurrencies(): Promise<string[]> {
    const rows = (await this.repository.query(
      `SELECT DISTINCT c AS currency
       FROM (
         SELECT ${OrderRecordRepository.NATIVE_CURRENCY_EXPR} AS c
         FROM "order_records" rec
       ) t
       WHERE c IS NOT NULL`
    )) as unknown;

    if (!Array.isArray(rows)) {
      return [];
    }

    // `SELECT DISTINCT` already de-duplicates; the Set keeps the "set, not
    // list" contract true independently of what the driver hands back.
    return [
      ...new Set(
        rows
          .map((row) => (row as { currency?: unknown }).currency)
          .filter((value): value is string => typeof value === 'string')
      ),
    ];
  }

  /**
   * Record a TERMINAL stamp answer (#2125). Same conditional-write shape as
   * {@link claimFxIntentIfAbsent}: `reportingCurrency: IsNull()` is what makes it
   * unable to touch a row that already carries a figure. Writes `fxStampedAt`
   * alone, which the `ck_order_records_fx_group` CHECK's first arm permits (it
   * constrains only the three figure columns).
   *
   * It does NOT also require `fxStampedAt IS NULL`, and that is deliberate
   * (#2135 review, finding 1): the sweep re-admits a terminal-but-figureless row
   * once its marker ages past the cooldown, and a re-answer must move the marker
   * forward or the row would be retried on every tick from then on. The
   * immutability that matters is the FIGURE's, and that is the predicate above -
   * a stamped row is untouchable here regardless of the timestamp.
   */
  async markFxTerminal(internalOrderId: string, fxStampedAt: Date): Promise<boolean> {
    const result = await this.repository.update(
      { internalOrderId, reportingCurrency: IsNull() },
      { fxStampedAt }
    );
    return (result.affected ?? 0) > 0;
  }

  /**
   * One bounded page of unanswered FX rows for the reconcile sweep (#2125).
   *
   * `select`-narrowed to the primary key: the sweep hands each id straight back
   * to `stamp()`, which re-reads the record anyway, so hydrating snapshots here
   * would pull a page of JSONB for nothing. Ordered NEWEST FIRST so that when
   * the frontier is larger than one page, the orders an operator is most likely
   * to be looking at are answered first.
   */
  async findUnstampedFxOrderIds(
    sourceConnectionId: string,
    options: { limit: number; createdSince: Date; terminalRetryBefore: Date }
  ): Promise<string[]> {
    // TWO branches, OR'd (TypeORM renders an array of `where` objects as OR).
    // `reportingCurrency IS NULL` is in BOTH and is the invariant: a row that
    // carries a figure is never re-entered, so the stamp stays immutable. The
    // second branch is the cooldown re-admission (#2135 review, finding 1) - a
    // terminal answer older than `terminalRetryBefore` that still produced no
    // figure gets one more attempt, which is what makes `no-rate-source` and a
    // throttle-induced `unsupported-pair` recoverable instead of permanent.
    const common = {
      sourceConnectionId,
      reportingCurrency: IsNull(),
      createdAt: MoreThanOrEqual(options.createdSince),
    };

    const rows = await this.repository.find({
      select: { internalOrderId: true },
      where: [
        { ...common, fxStampedAt: IsNull() },
        { ...common, fxStampedAt: LessThan(options.terminalRetryBefore) },
      ],
      order: { createdAt: 'DESC' },
      take: options.limit,
    });
    return rows.map((row) => row.internalOrderId);
  }

  /**
   * Stamped-row counts per reporting currency (#2126).
   *
   * `COUNT(*)::int` rather than a bare `COUNT(*)`: node-postgres hands `bigint`
   * back as a STRING, so the cast is what keeps the port's `number` contract
   * true instead of leaking `'3947'` into a JSON response. Values are still
   * re-coerced below, so a driver that ever changes its mind cannot produce a
   * `NaN` count.
   *
   * Quoted camelCase identifiers on purpose — no TypeORM `namingStrategy` is
   * configured anywhere in the repo, so `reporting_currency` would error at
   * runtime.
   */
  async countStampedByReportingCurrency(): Promise<StampedReportingCurrencyCount[]> {
    const rows = (await this.repository.query(
      `SELECT rec."reportingCurrency" AS currency, COUNT(*)::int AS count
       FROM "order_records" rec
       WHERE rec."reportingCurrency" IS NOT NULL
       GROUP BY rec."reportingCurrency"
       ORDER BY rec."reportingCurrency" ASC`
    )) as unknown;

    if (!Array.isArray(rows)) {
      return [];
    }

    return rows
      .map((row) => row as { currency?: unknown; count?: unknown })
      .filter((row): row is { currency: string; count: unknown } => typeof row.currency === 'string')
      .map((row) => ({
        reportingCurrency: row.currency,
        count: Number(row.count ?? 0),
      }))
      .filter((entry) => Number.isFinite(entry.count));
  }

  /**
   * Per-row order-native currency, guarded so a non-string `totals.currency`
   * reads as NULL instead of leaking a JSON scalar into the result set. Kept as
   * a constant because the migration's expression index must match it verbatim.
   */
  private static readonly NATIVE_CURRENCY_EXPR =
    `CASE WHEN jsonb_typeof(rec."orderSnapshot"#>'{totals,currency}') = 'string' ` +
    `THEN rec."orderSnapshot"#>>'{totals,currency}' END`;

  /**
   * Full-row upsert of the ingestion-owned columns, keyed on the primary key.
   *
   * `syncStatus` / `syncAttempts` (#2140), `fulfillmentState` (#2101),
   * `cancelledAt` (#1984), the three `salesDocument*` columns (#2100) and the
   * six FX snapshot columns (#2124) are deliberately outside the write set -
   * see the {@link toOrm} comments. A consequence is that the returned record
   * reports all of them as empty (`[]` / `null`) regardless of what the row
   * holds, because none of those columns was part of the statement; callers
   * needing their true value re-read via {@link findById}.
   *
   * ## Source attribution is immutable at the write path (#2282, ADR-057)
   *
   * `sourceConnectionId` is INSERT-ONLY: it is absent from the `DO UPDATE` set,
   * so the first write establishes the order's origin and no later re-ingestion
   * can move it. `sourceEventId` follows the rule *same-source may advance,
   * cross-source frozen*: a write arriving from the row's own source still
   * refreshes it to the latest event id (byte-identical to the pre-#2282
   * behaviour), while a write arriving from any other connection leaves it as
   * committed.
   *
   * This is why the statement is raw SQL rather than the previous full-object
   * `save()`. `sourceConnectionId` is `uuid NOT NULL` with no DB default, so it
   * MUST be on the INSERT half and MUST NOT be on the UPDATE half - a shape
   * `save()` cannot express, and one a read-before-write cannot emulate safely
   * (see the race doctrine in {@link toOrm}). The `markCancelled` COALESCE
   * statement is the same precedent.
   *
   * The caller-side ADR-017 destination-echo guard in `OrderIngestionService`
   * stays in place as defence in depth; this makes the invariant hold for every
   * caller of the write path, not just that one.
   */
  async upsert(orderRecord: OrderRecord): Promise<OrderRecord> {
    // The write set is defined once, by `toOrm` - the parameter tuple below is
    // built from it so the two cannot drift. Every column NOT named here keeps
    // its committed value (on conflict) or its DB default (on insert):
    // `syncStatus`, `syncAttempts` (#2140), `fulfillmentState` (#2101),
    // `cancelledAt` (#1984), the three `salesDocument*` columns (#2100) and the
    // six FX snapshot columns `reportingCurrency` / `reportingTotalAmount` /
    // `exchangeRateId` / `fxRule` / `fxStampedAt` / `fxIntendedCurrency`
    // (#2124). Do not add one of them to either half of this statement - each
    // has a narrow, atomic out-of-band writer that owns it.
    const entity = this.toOrm(orderRecord);

    const rows = (await this.repository.query(
      `INSERT INTO "order_records" (
         "internalOrderId", "customerId", "sourceConnectionId", "sourceEventId",
         "orderSnapshot", "recordStatus", "mappingFailureReason", "dispatchByAt",
         "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)
       ON CONFLICT ("internalOrderId") DO UPDATE SET
         "customerId" = EXCLUDED."customerId",
         -- Source attribution (#2282): "sourceConnectionId" is absent from this
         -- SET list on purpose. "sourceEventId" advances only when the write
         -- comes from the row's own source.
         "sourceEventId" = CASE
           WHEN "order_records"."sourceConnectionId" = EXCLUDED."sourceConnectionId"
             THEN EXCLUDED."sourceEventId"
           ELSE "order_records"."sourceEventId"
         END,
         "orderSnapshot" = EXCLUDED."orderSnapshot",
         "recordStatus" = EXCLUDED."recordStatus",
         "mappingFailureReason" = EXCLUDED."mappingFailureReason",
         "dispatchByAt" = EXCLUDED."dispatchByAt",
         -- "createdAt" is deliberately NOT updated: it records the first write.
         "updatedAt" = EXCLUDED."updatedAt"
       RETURNING *`,
      [
        entity.internalOrderId,
        entity.customerId,
        entity.sourceConnectionId,
        entity.sourceEventId,
        // Serialized explicitly rather than relying on the driver's object
        // handling, so the jsonb column receives a document in every case.
        JSON.stringify(entity.orderSnapshot ?? {}),
        entity.recordStatus,
        entity.mappingFailureReason,
        entity.dispatchByAt,
        entity.createdAt,
        entity.updatedAt,
      ]
    )) as unknown;

    if (!Array.isArray(rows) || rows.length === 0) {
      // Unreachable: `ON CONFLICT ... DO UPDATE` always produces a row.
      throw new OrderRecordNotFoundException(orderRecord.internalOrderId);
    }

    return this.toDomain(this.fromRawRow(rows[0] as Record<string, unknown>));
  }

  /**
   * Project a `RETURNING *` row onto an {@link OrderRecordOrmEntity}, resetting
   * every column outside the upsert's write set to its empty default.
   *
   * The reset is the point, not tidiness. `RETURNING *` carries the row's TRUE
   * values for the out-of-band columns, whereas the pre-#2282 `save()` returned
   * only what it wrote - and {@link upsert}'s contract (repeated on the port)
   * promises callers that those columns read empty and must be re-read via
   * {@link findById}. Passing the true values through would silently change
   * what both `OrderRecordService` call sites return.
   */
  private fromRawRow(row: Record<string, unknown>): OrderRecordOrmEntity {
    const entity = Object.assign(new OrderRecordOrmEntity(), row);
    entity.syncStatus = [];
    entity.syncAttempts = [];
    entity.fulfillmentState = null;
    entity.cancelledAt = null;
    entity.salesDocumentBlockReason = null;
    entity.salesDocumentUnresolvedReason = null;
    entity.salesDocumentBlockDetail = null;
    entity.reportingCurrency = null;
    entity.reportingTotalAmount = null;
    entity.exchangeRateId = null;
    entity.fxRule = null;
    entity.fxStampedAt = null;
    entity.fxIntendedCurrency = null;
    return entity;
  }

  /**
   * Atomic per-destination upsert + append.
   *
   * Single SQL statement so concurrent workers serialize on the row's
   * exclusive write lock (no read-modify-write race). The `syncAttempts`
   * column is capped per destination using a window function: rows are
   * ranked most-recent-first within each `destinationConnectionId`, and
   * only the top N are kept. Entries are wrapped via `jsonb_build_array`
   * so the binder can't collapse object/array semantics.
   */
  async updateSyncStatus(
    internalOrderId: string,
    destinationConnectionId: string,
    status: OrderSyncStatus,
    attempt: SyncAttempt
  ): Promise<void> {
    const newStatusRow: OrderSyncStatusJson = {
      destinationConnectionId: status.destinationConnectionId,
      status: status.status,
      syncedAt: status.syncedAt?.toISOString(),
      externalOrderId: status.externalOrderId,
      externalOrderNumber: status.externalOrderNumber,
      error: status.error,
    };

    const newAttemptRow: SyncAttemptJson = {
      destinationConnectionId: attempt.destinationConnectionId,
      status: attempt.status,
      attemptedAt: attempt.attemptedAt.toISOString(),
      error: attempt.error,
      externalOrderId: attempt.externalOrderId,
      externalOrderNumber: attempt.externalOrderNumber,
    };

    // Raw query keeps the JSONB expression and the parameter binding explicit
    // (TypeORM's UpdateQueryBuilder set-with-function path doesn't substitute
    // named params inside the raw SQL fragment reliably across versions).
    // pg returns `[rows, affected]` for UPDATE; TypeORM forwards that shape
    // through `Repository.query`, which is typed `Promise<any>`.
    const result = (await this.repository.query(
      `
      UPDATE "order_records"
      SET
        -- syncStatus: drop any existing row for this destination, then append
        -- the new current-state row at the tail. Per-destination upsert in one
        -- expression — no race because the whole UPDATE is one statement.
        "syncStatus" = (
          SELECT COALESCE(jsonb_agg(s), '[]'::jsonb)
          FROM jsonb_array_elements("syncStatus") s
          WHERE s->>'destinationConnectionId' != $2
        ) || jsonb_build_array($3::jsonb),
        -- syncAttempts: append the new attempt, then keep only the most-recent
        -- N per destination. \`ord\` from WITH ORDINALITY = JSONB array insertion
        -- order (chronological since we always append). The window function
        -- ranks DESC within each destination so rank 1 = newest; rows above the
        -- cap drop out. Outer \`ORDER BY ord\` re-chronologises the survivors.
        "syncAttempts" = (
          SELECT COALESCE(jsonb_agg(a ORDER BY ord), '[]'::jsonb)
          FROM (
            SELECT
              a, ord,
              ROW_NUMBER() OVER (
                PARTITION BY a->>'destinationConnectionId' ORDER BY ord DESC
              ) AS recency_rank
            FROM jsonb_array_elements(
              "syncAttempts" || jsonb_build_array($4::jsonb)
            ) WITH ORDINALITY AS t(a, ord)
          ) ranked
          WHERE recency_rank <= $5
        ),
        "updatedAt" = NOW()
      WHERE "internalOrderId" = $1
      `,
      [
        internalOrderId,
        destinationConnectionId,
        JSON.stringify(newStatusRow),
        JSON.stringify(newAttemptRow),
        SYNC_ATTEMPTS_PER_DESTINATION_CAP,
      ]
    )) as unknown;

    const affected = Array.isArray(result) && typeof result[1] === 'number' ? result[1] : 0;
    if (affected === 0) {
      throw new OrderRecordNotFoundException(internalOrderId);
    }
  }

  /**
   * Convert ORM entity to domain entity
   */
  private toDomain(entity: OrderRecordOrmEntity): OrderRecord {
    // `?? []` because {@link upsert} feeds this the entity it handed `save()`,
    // whose `syncStatus` property is unset by design (#2140) - undefined on the
    // update path, where TypeORM has no RETURNING clause to fill it back in.
    // A row read from the database always carries the column (NOT NULL).
    const syncStatus: OrderSyncStatus[] = (entity.syncStatus ?? []).map((s) => ({
      destinationConnectionId: s.destinationConnectionId,
      status: s.status,
      syncedAt: s.syncedAt ? new Date(s.syncedAt) : undefined,
      externalOrderId: s.externalOrderId,
      externalOrderNumber: s.externalOrderNumber,
      error: s.error,
    }));

    const syncAttempts: SyncAttempt[] = (entity.syncAttempts ?? []).map((a) => ({
      destinationConnectionId: a.destinationConnectionId,
      status: a.status,
      attemptedAt: new Date(a.attemptedAt),
      error: a.error,
      externalOrderId: a.externalOrderId,
      externalOrderNumber: a.externalOrderNumber,
    }));

    return new OrderRecord(
      entity.internalOrderId,
      entity.customerId,
      entity.sourceConnectionId,
      entity.sourceEventId,
      entity.orderSnapshot,
      syncStatus,
      (entity.recordStatus as OrderRecordStatus) ?? 'ready',
      entity.createdAt,
      entity.updatedAt,
      syncAttempts,
      entity.dispatchByAt,
      (entity.fulfillmentState as FulfillmentRollupState | null) ?? null,
      entity.mappingFailureReason ?? null,
      entity.cancelledAt ?? null,
      // Coerced through the guard rather than cast: the column is a plain
      // `varchar`, so a value written by an older/newer release (or by hand)
      // must degrade to "no block" instead of reaching the UI as an unknown
      // literal the badge mapper has no label for.
      isSalesDocumentGateBlockReason(entity.salesDocumentBlockReason)
        ? entity.salesDocumentBlockReason
        : null,
      isSalesDocumentUnresolvedReason(entity.salesDocumentUnresolvedReason)
        ? entity.salesDocumentUnresolvedReason
        : null,
      entity.salesDocumentBlockDetail ?? null,
      entity.reportingCurrency ?? null,
      // `numeric` comes back from pg as a string; `Number()` per the house
      // money convention (mirrors every other decimal column in the repo).
      // Guarded so a NULL column stays `null` rather than becoming `0`.
      entity.reportingTotalAmount === null || entity.reportingTotalAmount === undefined
        ? null
        : Number(entity.reportingTotalAmount),
      entity.exchangeRateId ?? null,
      entity.fxRule ?? null,
      entity.fxStampedAt ?? null,
      entity.fxIntendedCurrency ?? null
    );
  }

  /**
   * Convert domain entity to ORM entity
   *
   * ## Columns deliberately outside the write set
   *
   * `syncStatus`, `syncAttempts`, `fulfillmentState` and `cancelledAt` are
   * intentionally left unset below. Each is OL-owned state that no source
   * payload carries and that a dedicated narrow `UPDATE` owns; leaving the
   * property unset makes TypeORM omit the column from the generated statement
   * entirely, so the row's committed value survives untouched.
   *
   * This is not optional tidiness. `upsert()` is a full-object `save()` with no
   * per-order lock around it (webhook + reconciliation poll legitimately race
   * for the same order, per `docs/architecture-overview.md` § "Webhook =
   * trigger, poll = reconciliation backstop"), so mapping any of them lets the
   * ingestion path's in-memory value stomp what the real writer committed. A
   * read-before-write is NOT the fix - it still loses whatever commits between
   * that read and this save. Omitting the column is the only race-free option.
   *
   * - `syncStatus` / `syncAttempts` (#2140) - sole writer `updateSyncStatus`.
   *   For `syncAttempts` the wipe was irreversible: the JSONB array *is* the
   *   store, so an operator retry erased the failed -> retried -> synced
   *   narrative the activity timeline renders. For `syncStatus` it blinded
   *   every reader of the per-destination rows while the destination
   *   order-create calls run - the retry action 404s, fulfillment tracking
   *   skips the order - permanently so whenever the writeback never runs.
   *   Both rely on the column's `DEFAULT '[]'` on insert (asserted by
   *   `1833000000005-set-order-records-sync-status-default.ts`).
   * - `fulfillmentState` (#2101) - sole writer `updateFulfillmentState`, a
   *   rollup over the order's shipments. The wipe made a dispatched order
   *   reappear as not-shipped in the ship-by SLA buckets and list filter.
   * - `cancelledAt` (#1984) - sole writer `markCancelled` (COALESCE-based,
   *   atomic).
   * - The three `salesDocument*` columns (#2100) - sole writer
   *   `updateSalesDocumentBlock`, with a reason of their own on top of the
   *   shared one: `persistOrder` runs BEFORE the auto-issue gate on every
   *   ingestion, so round-tripping them here would null the columns and then
   *   immediately re-set them - a visible flicker for any concurrent read, and
   *   a stomp against a reason a peer transition just wrote.
   * - The six FX snapshot columns (#2124) - sole writers `claimFxIntentIfAbsent`
   *   + `stampFxIfAbsent` (both guarded, both single-statement). Mapping them
   *   here would let a re-poll of an already-stamped order overwrite a
   *   REPORTED FINANCIAL FIGURE with the ingestion path's in-memory `null`.
   *
   * ## The insert-only column
   *
   * `sourceConnectionId` IS assigned here, but it is insert-only at the
   * statement level (#2282): {@link upsert} places it on the INSERT half and
   * omits it from `DO UPDATE`. It cannot simply be left unset like the columns
   * above, because it is `uuid NOT NULL` with no DB default and so must be
   * present on a first write.
   *
   * Before adding an assignment here, ask which out-of-band writer owns that
   * column: #2101 excluded only `fulfillmentState` and left the two columns
   * with the identical defect assigned three lines above its own comment,
   * which is what #2140 then had to fix.
   */
  private toOrm(orderRecord: OrderRecord): OrderRecordOrmEntity {
    const entity = new OrderRecordOrmEntity();
    entity.internalOrderId = orderRecord.internalOrderId;
    entity.customerId = orderRecord.customerId;
    entity.sourceConnectionId = orderRecord.sourceConnectionId;
    entity.sourceEventId = orderRecord.sourceEventId;
    entity.orderSnapshot = orderRecord.orderSnapshot;
    entity.recordStatus = orderRecord.recordStatus;
    entity.mappingFailureReason = orderRecord.mappingFailureReason;
    entity.dispatchByAt = orderRecord.dispatchByAt;
    // The six FX snapshot columns (#2124) are deliberately NOT mapped here,
    // for the strongest version of the reason documented above for
    // `fulfillmentState` / `cancelledAt` / `salesDocument*`: this is a
    // full-row save() on an update-or-create ingestion path, so mapping them
    // would let a re-poll of an already-stamped order write the ingestion
    // path's in-memory `null` over a REPORTED FINANCIAL FIGURE. Leaving the
    // properties unset makes TypeORM omit the columns from the generated
    // UPDATE entirely. `claimFxIntentIfAbsent` + `stampFxIfAbsent` (both
    // guarded, both single-statement) are their only writers.
    entity.createdAt = orderRecord.createdAt;
    entity.updatedAt = orderRecord.updatedAt;
    return entity;
  }
}
