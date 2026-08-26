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
import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm';
import { In, IsNull, LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import type { OrderSyncStatusJson, SyncAttemptJson } from '../entities/order-record.orm-entity';
import { OrderRecordOrmEntity } from '../entities/order-record.orm-entity';
import { OrderLineItemOrmEntity } from '../entities/order-line-item.orm-entity';
import type { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import { OrderRecord } from '../../../domain/entities/order-record.entity';
import type { OrderLineItemDraft } from '../../../domain/order-analytics-projection';
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
import {
  netSalesLineNetAmountSql,
  netSalesOrderNetEligibleSql,
} from '../../../domain/types/net-sales-tax-rate.types';
import type { SalesDocumentBlock } from '@openlinker/core/sales-documents';
import {
  SalesDocumentAttentionReasonValues,
  isSalesDocumentGateBlockReason,
  isSalesDocumentUnresolvedReason,
  isTaxRateEra,
} from '@openlinker/core/sales-documents';
import type { PriceTaxTreatment } from '../../../domain/types/order.types';
import type { OrderFxIntent, OrderFxStamp } from '../../../domain/types/order-fx.types';
import type { StampedReportingCurrencyCount } from '../../../domain/types/order-fx-read.types';
import type {
  DailyOrderAggregateRow,
  SalesAnalyticsFilters,
} from '../../../domain/types/order-sales-analytics.types';
import type {
  CoverageDetectionPagination,
  PaginatedCurrencyMismatchOrders,
  NetExcludedOrderCandidate,
} from '../../../domain/types/coverage-detection.types';

@Injectable()
export class OrderRecordRepository implements OrderRecordRepositoryPort {
  constructor(
    @InjectRepository(OrderRecordOrmEntity)
    private readonly repository: Repository<OrderRecordOrmEntity>
  ) {}

  /**
   * DataSource from the injected repository's connection — the established
   * workaround for injecting DataSource in core library modules (mirrors
   * `SyncJobRepository.dataSource`), used so `upsertWithLineItems` can run
   * both writes in one transaction without a second NestJS-injected repository.
   */
  private get dataSource(): DataSource {
    return this.repository.manager.connection;
  }

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

  /**
   * Batch earliest-order-date lookup by source connection (#2083). One
   * `GROUP BY` aggregate query, not a per-connection fan-out — mirrors
   * `findByIds`'s "absent id = no match" convention for connections with
   * zero rows. Deliberately unfiltered by `recordStatus` — see the port's
   * JSDoc for why no `NOT_MAPPING_OR_DELETED`-style gate applies here.
   */
  async findEarliestOrderDateByConnection(connectionIds: string[]): Promise<Map<string, Date>> {
    if (connectionIds.length === 0) {
      return new Map();
    }

    const rows = await this.repository
      .createQueryBuilder('rec')
      .select('rec.sourceConnectionId', 'source_connection_id')
      .addSelect(`MIN(COALESCE(rec."placedAt", rec."createdAt"))`, 'earliest_at')
      .where('rec.sourceConnectionId IN (:...connectionIds)', { connectionIds })
      .groupBy('rec.sourceConnectionId')
      .getRawMany<{ source_connection_id: string; earliest_at: Date }>();

    return new Map(rows.map((row) => [row.source_connection_id, row.earliest_at]));
  }

  async countOrdersByRoutingCountrySince(
    since: Date
  ): Promise<{ country: string; orderCount: number }[]> {
    // ONE grouped query for every market, never one per country. The country
    // expression reads the DELIVERY address, matching what the rule engine
    // routes on (#2518, ADR-066); `#>>` yields NULL rather than throwing when
    // the snapshot has no shippingAddress object at all, and the NULLIF strips
    // a blank one so it groups as "no country" and is then filtered out.
    const rows = await this.repository
      .createQueryBuilder('rec')
      .select(OrderRecordRepository.ROUTING_COUNTRY_EXPR, 'country')
      .addSelect('COUNT(*)', 'order_count')
      .where(`COALESCE(rec."placedAt", rec."createdAt") >= :since`, { since })
      .andWhere(`${OrderRecordRepository.ROUTING_COUNTRY_EXPR} IS NOT NULL`)
      .groupBy(OrderRecordRepository.ROUTING_COUNTRY_EXPR)
      .orderBy('COUNT(*)', 'DESC')
      // Deterministic tiebreak so two markets with equal counts do not swap
      // places between page loads.
      .addOrderBy(OrderRecordRepository.ROUTING_COUNTRY_EXPR, 'ASC')
      .getRawMany<{ country: string; order_count: string }>();

    // pg returns COUNT(*) as a string at the driver level, mirroring the
    // Number() the money columns already get in `toDomain`.
    return rows.map((row) => ({ country: row.country, orderCount: Number(row.order_count) }));
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

    if (filters.taxRateConflict !== undefined) {
      // #2254 — its own axis, ANDed with the others exactly like
      // `salesDocumentBlocked`: "issued AND the rates disagree" is the shape
      // this filter exists to find, and it is invisible in every other view.
      qb.andWhere(
        filters.taxRateConflict
          ? OrderRecordRepository.HAS_TAX_RATE_CONFLICT
          : `NOT (${OrderRecordRepository.HAS_TAX_RATE_CONFLICT})`,
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
      )
      // #2254 — its own count, so it is never inside `sales_document_blocked`.
      // The two populations overlap freely: an order can be both blocked and in
      // conflict, and printing one number twice is what the separate field
      // avoids.
      .addSelect(
        `COUNT(*) FILTER (WHERE ${OrderRecordRepository.HAS_TAX_RATE_CONFLICT})`,
        'tax_rate_conflict'
      )
      // #2254 — the oldest still-held order, so the chip label can carry an age
      // rather than a bare count. MIN over the held population only; NULL when
      // nothing is held, which the caller renders as no age clause at all.
      .addSelect(
        `MIN(rec."salesDocumentBlockedAt") FILTER (WHERE ${OrderRecordRepository.IS_SALES_DOCUMENT_BLOCKED})`,
        'sales_document_blocked_oldest_at'
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
      tax_rate_conflict: string;
      sales_document_blocked_oldest_at: Date | null;
    }>();

    return {
      total: Number(raw?.total ?? 0),
      sourceDeleted: Number(raw?.source_deleted ?? 0),
      awaitingMapping: Number(raw?.awaiting_mapping ?? 0),
      needsAttention: Number(raw?.needs_attention ?? 0),
      synced: Number(raw?.synced ?? 0),
      awaitingDispatch: Number(raw?.awaiting_dispatch ?? 0),
      salesDocumentBlocked: Number(raw?.sales_document_blocked ?? 0),
      taxRateConflict: Number(raw?.tax_rate_conflict ?? 0),
      salesDocumentBlockedOldestAt: raw?.sales_document_blocked_oldest_at ?? null,
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
   * Daily, per-connection revenue/order-count aggregates (#1987). One row per
   * `(day, sourceConnectionId)` with at least one matching order; the
   * cancelled/non-cancelled split uses `FILTER (WHERE ...)`, mirroring
   * `getFailedSyncValueSummary`'s `stuckPredicate` idiom.
   *
   * Currency correctness (#2049/ADR-040 follow-up): `order_count`/`revenue`
   * are further restricted to `reportingCurrency IS NOT NULL` — one
   * comparable currency, `SUM(reportingTotalAmount)` — with the complementary
   * unstamped slice reported separately as `unconverted_count`/
   * `unconverted_value` (native `totalAmount`, informational only) rather
   * than silently mixed in or silently dropped. `cancelled_value` is left on
   * native `totalAmount`, unchanged — a secondary figure, not revisited here.
   *
   * `unconverted_currency` (#1987 scope, not FX-epic scope — `order_records.
   * currency` is the pre-existing native-currency column from #1985, untouched
   * by #2049) labels the `unconverted_value` figure with the one native
   * currency shared by every unconverted, non-cancelled order this
   * day/connection, or `NULL` when that set already mixes currencies. A day
   * with zero unconverted orders also reports `NULL` here (no currency to
   * report), which the aggregation layer must not confuse with "mixed" — see
   * `resolveUniformUnconvertedCurrency`.
   */
  async getDailyOrderAggregates(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<DailyOrderAggregateRow[]> {
    const notCancelled = 'rec."cancelledAt" IS NULL';
    const isCancelled = 'rec."cancelledAt" IS NOT NULL';
    // Current-era stamp only (#1987 review notes) — `reportingCurrency` never
    // moves once set (ADR-040), so `IS NOT NULL` alone would sum a prior era's
    // figures into `revenue` after an operator changes the reporting setting.
    // A prior-era stamp therefore reads as unconverted, same as never-stamped.
    const isStamped = 'rec."reportingCurrency" = :currentReportingCurrency';
    const isUnconverted = `(rec."reportingCurrency" IS NULL OR rec."reportingCurrency" != :currentReportingCurrency)`;
    const stampedAndNotCancelled = `${notCancelled} AND ${isStamped}`;
    const unconvertedAndNotCancelled = `${notCancelled} AND ${isUnconverted}`;

    // Net-sales (VAT-exclusive) eligibility — see `buildNetSalesOrderFragments`.
    const { netEligible, netOrderAmount } = this.buildNetSalesOrderFragments();
    const netAndNotCancelled = `${stampedAndNotCancelled} AND ${netEligible}`;
    const netExcludedAndNotCancelled = `${stampedAndNotCancelled} AND NOT ${netEligible}`;

    // UTC day boundary made explicit (#1987 review, IMPORTANT 2): `placedAt`
    // is `timestamptz`, so a bare `date_trunc('day', ...)` truncates at local
    // midnight per the Postgres session `TimeZone` GUC — on a non-UTC server
    // every bucket would land on the wrong calendar day and silently mismatch
    // `enumerateDayKeys`'s UTC day keys. The trailing `AT TIME ZONE 'UTC'` is
    // required too: without it the column round-trips as a bare `timestamp`,
    // which node-postgres parses in the Node process's own local time,
    // reintroducing the same shift one layer up.
    const utcDay = `date_trunc('day', rec."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

    const qb = this.repository
      .createQueryBuilder('rec')
      .select(utcDay, 'day')
      .addSelect('rec.sourceConnectionId', 'source_connection_id')
      .addSelect(`COUNT(*) FILTER (WHERE ${stampedAndNotCancelled})`, 'order_count')
      .addSelect(
        `COALESCE(SUM(rec."reportingTotalAmount") FILTER (WHERE ${stampedAndNotCancelled}), 0)`,
        'revenue'
      )
      .addSelect(`COUNT(*) FILTER (WHERE ${unconvertedAndNotCancelled})`, 'unconverted_count')
      .addSelect(
        `COALESCE(SUM(rec."totalAmount") FILTER (WHERE ${unconvertedAndNotCancelled}), 0)`,
        'unconverted_value'
      )
      .addSelect(
        // The DISTINCT count alone ignores NULLs (#1987 review, suggestion
        // 4): a bucket whose unconverted orders are {NULL, 'PLN'} counts one
        // distinct value and would label the whole sum 'PLN' even though one
        // order's native currency is unrecorded. The extra `COUNT(*) FILTER
        // (... currency IS NULL) = 0` arm makes "partly unknown" a third,
        // non-`NULL`-mislabelled outcome alongside "nothing to report" and
        // "mixed".
        `CASE WHEN COUNT(DISTINCT rec."currency") FILTER (WHERE ${unconvertedAndNotCancelled}) <= 1
              AND COUNT(*) FILTER (WHERE ${unconvertedAndNotCancelled} AND rec."currency" IS NULL) = 0
              THEN MAX(rec."currency") FILTER (WHERE ${unconvertedAndNotCancelled})
              ELSE NULL END`,
        'unconverted_currency'
      )
      .addSelect(`COUNT(*) FILTER (WHERE ${isCancelled})`, 'cancelled_count')
      .addSelect(
        `COALESCE(SUM(rec."totalAmount") FILTER (WHERE ${isCancelled}), 0)`,
        'cancelled_value'
      )
      .addSelect(
        // `isStamped` now filters on `reportingCurrency = :currentReportingCurrency`
        // (#1987 review notes), so every row it matches already carries the
        // same value — no cross-row DISTINCT guard is needed here the way
        // `unconverted_currency` needs one. `NULL` when the bucket has no
        // current-era stamped order (nothing to label), matching
        // `unconverted_currency`'s "nothing to report" convention.
        `MAX(rec."reportingCurrency") FILTER (WHERE ${isStamped})`,
        'reporting_currency'
      )
      .addSelect(
        `COALESCE(SUM((${netOrderAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${netAndNotCancelled}), 0)`,
        'net_revenue'
      )
      .addSelect(`COUNT(*) FILTER (WHERE ${netExcludedAndNotCancelled})`, 'net_excluded_count')
      .addSelect(
        `COALESCE(SUM(rec."totalAmount") FILTER (WHERE ${netExcludedAndNotCancelled}), 0)`,
        'net_excluded_value'
      )
      .groupBy(utcDay)
      .addGroupBy('rec.sourceConnectionId');

    qb.setParameter('currentReportingCurrency', currentReportingCurrency);
    this.applySalesAnalyticsScope(qb, filters);

    const rows = await qb.getRawMany<{
      day: Date;
      source_connection_id: string;
      order_count: string;
      revenue: string;
      unconverted_count: string;
      unconverted_value: string;
      unconverted_currency: string | null;
      cancelled_count: string;
      cancelled_value: string;
      reporting_currency: string | null;
      net_revenue: string;
      net_excluded_count: string;
      net_excluded_value: string;
    }>();

    return rows.map((row) => ({
      day: row.day,
      sourceConnectionId: row.source_connection_id,
      orderCount: Number(row.order_count),
      revenue: Number(row.revenue),
      unconvertedCount: Number(row.unconverted_count),
      unconvertedValue: Number(row.unconverted_value),
      unconvertedCurrency: row.unconverted_currency,
      cancelledCount: Number(row.cancelled_count),
      cancelledValue: Number(row.cancelled_value),
      reportingCurrency: row.reporting_currency,
      netRevenue: Number(row.net_revenue),
      netExcludedCount: Number(row.net_excluded_count),
      netExcludedValue: Number(row.net_excluded_value),
    }));
  }

  /**
   * Data Coverage 'currency' category drill-down (#2464). Paged list of
   * orders whose reporting-currency stamp does not (yet) match the current
   * setting, covering BOTH populations under one combined predicate - a
   * never-stamped row (`reportingCurrency IS NULL`) and a stamped-but-stale
   * row from a prior reporting-currency era (ADR-040) - so the returned
   * `total` is exactly the same figure {@link getDailyOrderAggregates}
   * reports as `unconvertedCount`, summed over the same filters (asserted
   * as a regression guard by the #2464 tests).
   *
   * Deliberately the SAME scope predicate as `unconvertedAndNotCancelled`
   * in {@link getDailyOrderAggregates} (`recordStatus = 'ready'`, resolvable
   * `placedAt`/`totalAmount`, in-range, optional connection, non-cancelled)
   * so the two reads can never silently diverge on what counts as
   * "unconverted". Ordered newest-first so an operator drilling in sees the
   * most recent mismatches first, mirroring `findUnstampedFxOrderIds`'s
   * "most likely to matter" ordering convention.
   */
  async findCurrencyMismatchOrders(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string,
    pagination: CoverageDetectionPagination
  ): Promise<PaginatedCurrencyMismatchOrders> {
    const qb = this.repository
      .createQueryBuilder('rec')
      .andWhere('rec."cancelledAt" IS NULL')
      .andWhere(
        '(rec."reportingCurrency" IS NULL OR rec."reportingCurrency" != :currentReportingCurrency)',
        { currentReportingCurrency }
      )
      .orderBy('rec."placedAt"', 'DESC')
      .take(pagination.limit)
      .skip(pagination.offset);

    this.applySalesAnalyticsScope(qb, filters);

    const [entities, total] = await qb.getManyAndCount();

    return {
      items: entities.map((entity) => ({
        internalOrderId: entity.internalOrderId,
        sourceConnectionId: entity.sourceConnectionId,
        nativeCurrency: entity.currency,
        stampedCurrency: entity.reportingCurrency,
        stampedAt: entity.fxStampedAt,
      })),
      total,
    };
  }

  /**
   * Data Coverage tax A/B/C detector's base population (#2465) — see the
   * port's JSDoc for the predicate rationale. Mirrors
   * `getDailyOrderAggregates`'s `netExcludedAndNotCancelled` fragment
   * EXACTLY (non-cancelled, current-era stamped, `NOT` net-eligible) so
   * `candidates.length` is always the same figure as `netExcludedCount`
   * for the identical filters/currency.
   */
  async findNetExcludedOrderCandidates(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<NetExcludedOrderCandidate[]> {
    const { netEligible } = this.buildNetSalesOrderFragments();
    const netExcludedAndNotCancelled = `rec."cancelledAt" IS NULL AND rec."reportingCurrency" = :currentReportingCurrency AND NOT ${netEligible}`;

    const qb = this.repository
      .createQueryBuilder('rec')
      .andWhere(netExcludedAndNotCancelled, { currentReportingCurrency })
      .orderBy('rec."placedAt"', 'DESC');

    this.applySalesAnalyticsScope(qb, filters);

    const entities = await qb.getMany();

    return entities.map((entity) => ({
      internalOrderId: entity.internalOrderId,
      sourceConnectionId: entity.sourceConnectionId,
      placedAt: entity.placedAt,
      taxRateEra: entity.taxRateEra,
    }));
  }

  /**
   * Headline median order value via `PERCENTILE_CONT` (#1987) — always
   * excludes cancelled orders, unlike {@link getDailyOrderAggregates} (which
   * reports them in a separate column rather than omitting them). `null`
   * when no row matches (an empty ordered-set aggregate).
   *
   * Currency correctness (#1987 review notes): computed over
   * `reportingTotalAmount`, restricted to `reportingCurrency =
   * currentReportingCurrency` — the same current-era stamped subset
   * {@link getDailyOrderAggregates} uses for `revenue`, so the headline
   * median stays comparable with the headline revenue/AOV figures rather
   * than mixing a native-currency or prior-era distribution into the
   * current one.
   */
  async getMedianOrderValue(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<number | null> {
    const qb = this.repository
      .createQueryBuilder('rec')
      .select(`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY rec."reportingTotalAmount")`, 'median')
      .andWhere('rec."cancelledAt" IS NULL')
      .andWhere('rec."reportingCurrency" = :currentReportingCurrency', { currentReportingCurrency });

    this.applySalesAnalyticsScope(qb, filters);

    const raw = await qb.getRawOne<{ median: string | null }>();
    return raw?.median != null ? Number(raw.median) : null;
  }

  /**
   * VAT-exclusive counterpart of {@link getMedianOrderValue} — same scope,
   * additionally restricted to net-sales-eligible orders (see
   * {@link buildNetSalesOrderFragments}). `null` on an empty ordered-set,
   * same convention as the gross median.
   */
  async getNetMedianOrderValue(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<number | null> {
    const { netEligible, netOrderAmount } = this.buildNetSalesOrderFragments();

    const qb = this.repository
      .createQueryBuilder('rec')
      .select(
        `PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY (${netOrderAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0)))`,
        'median'
      )
      .andWhere('rec."cancelledAt" IS NULL')
      .andWhere('rec."reportingCurrency" = :currentReportingCurrency', { currentReportingCurrency })
      .andWhere(netEligible);

    this.applySalesAnalyticsScope(qb, filters);

    const raw = await qb.getRawOne<{ median: string | null }>();
    return raw?.median != null ? Number(raw.median) : null;
  }

  /**
   * Shared SQL fragments for net-sales (VAT-exclusive) order eligibility
   * (net-sales tax-rate epic) — an order counts toward a net figure only
   * when it is not pre-rollout history (ADR-063 § Consequences) AND carries
   * at least one line AND, for gross-priced orders, every line resolves to a
   * known tax-rate fraction via {@link resolveNetSalesTaxRate}. Net-priced
   * (`taxTreatment = 'exclusive'`) orders need no resolvable rate — unit
   * prices are already VAT-exclusive (#2440). Expressed as correlated
   * subqueries rather than a JOIN to `order_line_items`: joining would
   * multiply the caller's row cardinality (one row per order-line instead of
   * one per order), corrupting every `COUNT(*)`/`SUM` aggregate grouped at
   * the order level.
   */
  private buildNetSalesOrderFragments(): { netEligible: string; netOrderAmount: string } {
    const netEligible = netSalesOrderNetEligibleSql(
      'rec."internalOrderId"',
      'net_li',
      'rec."taxTreatment"'
    );
    const lineNetAmount = netSalesLineNetAmountSql(
      'net_li."unitPrice"',
      'net_li."quantity"',
      'net_li."taxRate"',
      'rec."taxTreatment"'
    );
    const netOrderAmount = `(
      SELECT COALESCE(SUM(${lineNetAmount}), 0)
      FROM order_line_items net_li
      WHERE net_li."orderRecordId" = rec."internalOrderId"
    )`;
    return { netEligible, netOrderAmount };
  }

  /**
   * Shared scope predicate for the #1987 sales-analytics reads: only
   * `'ready'` records with a resolvable `placedAt`/`totalAmount`, within
   * `[filters.from, filters.to)`, optionally narrowed to one connection.
   */
  private applySalesAnalyticsScope(
    qb: SelectQueryBuilder<OrderRecordOrmEntity>,
    filters: SalesAnalyticsFilters
  ): void {
    qb.andWhere(`rec."recordStatus" = 'ready'`)
      .andWhere('rec."placedAt" IS NOT NULL')
      .andWhere('rec."totalAmount" IS NOT NULL')
      .andWhere('rec."placedAt" >= :salesFrom', { salesFrom: filters.from })
      .andWhere('rec."placedAt" < :salesTo', { salesTo: filters.to });

    if (filters.sourceConnectionId) {
      qb.andWhere('rec.sourceConnectionId = :salesConnectionId', {
        salesConnectionId: filters.sourceConnectionId,
      });
    }
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
  /**
   * A line where the shop and the channel named DIFFERENT rates (#2254).
   *
   * `taxRateChannel` is written on a line only when the two disagreed, so its
   * mere presence is the conflict - no comparison is needed here, and none is
   * possible in SQL against a jsonb array without a lateral join.
   *
   * Deliberately NOT part of the block predicate: a conflict does not stop the
   * invoice, so folding it in would both double-count it inside
   * `salesDocumentBlocked` and route its badge through a resolver that
   * suppresses itself whenever an invoice exists (epic F1).
   */
  private static readonly HAS_TAX_RATE_CONFLICT = `jsonb_path_exists(rec."orderSnapshot", '$.items[*].taxRateChannel')`;

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
  /**
   * The country routing evaluates on (#2518) - the DELIVERY address country,
   * the same field `toSalesDocumentOrderFacts` reads. `NULLIF(btrim(...), '')`
   * makes a blank indistinguishable from absent, so both are excluded rather
   * than one of them becoming a market with an empty name.
   */
  private static readonly ROUTING_COUNTRY_EXPR = `NULLIF(btrim(rec."orderSnapshot"#>>'{shippingAddress,country}'), '')`;

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
    // The two instants (#2248 / #2245 F4) are derived from the TRANSITION, in the
    // same statement, because they are facts about when the reason column changed
    // and only this UPDATE knows both the old and the new value. Computing them
    // caller-side would need a read first, which is exactly the race the no-op
    // guard below exists to avoid.
    //
    // `blockedAt` is stamped only on none -> blocked, so it survives a change of
    // reason and keeps measuring how long the order has actually been held. A
    // reason that changes (manual, then missing-tax-rate) is the same episode from
    // the operator's point of view; restamping would reset an age they are
    // watching. `releasedAt` is stamped on blocked -> none and cleared whenever a
    // block starts, so the pair always describes the CURRENT episode rather than
    // an arbitrary mix of two.
    await this.repository.query(
      `UPDATE "order_records"
          SET "salesDocumentBlockReason" = $1,
              "salesDocumentUnresolvedReason" = $2,
              "salesDocumentBlockDetail" = $3,
              "salesDocumentBlockedAt" = CASE
                WHEN $1 IS NOT NULL AND "salesDocumentBlockReason" IS NULL THEN now()
                ELSE "salesDocumentBlockedAt"
              END,
              "salesDocumentBlockReleasedAt" = CASE
                WHEN $1 IS NULL AND "salesDocumentBlockReason" IS NOT NULL THEN now()
                WHEN $1 IS NOT NULL THEN NULL
                ELSE "salesDocumentBlockReleasedAt"
              END,
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

  async patchSnapshotTaxRates(
    internalOrderId: string,
    lineNumber: number,
    patch: { taxRate: string; taxSource: 'backfill'; taxRateReadAt: Date }
  ): Promise<void> {
    const lineNumberStr = String(lineNumber);
    await this.repository.query(
      `UPDATE "order_records"
       SET "orderSnapshot" = jsonb_set(
             jsonb_set(
               jsonb_set(
                 "orderSnapshot",
                 ARRAY['items', $1, 'taxRate'],
                 to_jsonb($2::text),
                 true
               ),
               ARRAY['items', $1, 'taxSource'],
               to_jsonb($3::text),
               true
             ),
             ARRAY['items', $1, 'taxRateReadAt'],
             to_jsonb($4::text),
             true
           )
       WHERE "internalOrderId" = $5
         AND jsonb_typeof("orderSnapshot"#>ARRAY['items', $1]) = 'object'
         AND NOT ("orderSnapshot"#>ARRAY['items', $1] ? 'taxRate')`,
      [
        lineNumberStr,
        patch.taxRate,
        patch.taxSource,
        patch.taxRateReadAt.toISOString(),
        internalOrderId,
      ]
    );
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
   * `cancelledAt` (#1984), the three `salesDocument*` columns (#2100), the
   * six FX snapshot columns (#2124), and the four analytics scalars (#1985 —
   * `placedAt` / `currency` / `taxTreatment` / `totalAmount`) are deliberately
   * outside the write set - see the {@link toOrm} comments. A consequence is
   * that the returned record reports all of them as empty (`[]` / `null`)
   * regardless of what the row holds, because none of those columns was part
   * of the statement; callers needing their true value re-read via
   * {@link findById}.
   *
   * This is the sole writer reached by `persistIncomingSnapshot`, which never
   * has a resolved analytics figure to offer (its `OrderRecord` carries the
   * four scalars at their constructor `null` default) - mapping them here
   * would NULL out whatever `upsertWithLineItems` below previously wrote on a
   * re-poll of an already-`ready` order, and leave them permanently NULL if
   * item resolution then fails, orphaning any `order_line_items` rows that
   * survive the narrower `markItemResolutionFailure` update.
   */
  async upsert(orderRecord: OrderRecord): Promise<OrderRecord> {
    const entity = this.toOrm(orderRecord);
    // TypeORM save() performs upsert on primary key (internalOrderId)
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  /**
   * Upsert the order record AND replace its `order_line_items` rows in one
   * transaction (#1985). Delete-then-reinsert per order — simpler and
   * equally correct at this table's size than a diffing upsert, and avoids
   * ever leaving a stale row from a shrunk item list. Both writes go through
   * the same transactional `EntityManager`, so a failure on either side rolls
   * back both (no order_records/order_line_items desync).
   *
   * The sole writer of the four analytics scalars (#1985) - stamped onto the
   * entity here, not in the shared {@link toOrm}, because `upsert()` above
   * reaches the same conversion from `persistIncomingSnapshot`, which has no
   * resolved figure to offer yet (see its comment there).
   */
  async upsertWithLineItems(
    orderRecord: OrderRecord,
    lineItems: OrderLineItemDraft[]
  ): Promise<OrderRecord> {
    const entity = this.toOrm(orderRecord);
    entity.placedAt = orderRecord.placedAt;
    entity.currency = orderRecord.currency;
    entity.taxTreatment = orderRecord.taxTreatment;
    entity.totalAmount = orderRecord.totalAmount;
    // Same reason the four scalars above are stamped here rather than in the
    // shared toOrm: `upsert()` is also reached by `persistIncomingSnapshot`,
    // which has no resolved billing address to read a tax id off, so mapping
    // the column there would NULL a value a previous ready-path write settled.
    entity.buyerTaxId = orderRecord.buyerTaxId;
    const savedRecord = await this.dataSource.transaction(async (manager: EntityManager) => {
      const saved = await manager.save(OrderRecordOrmEntity, entity);
      await manager.delete(OrderLineItemOrmEntity, { orderRecordId: orderRecord.internalOrderId });
      if (lineItems.length > 0) {
        await manager.save(
          OrderLineItemOrmEntity,
          lineItems.map((item) => this.lineItemToOrm(orderRecord.internalOrderId, item))
        );
      }
      return saved;
    });
    return this.toDomain(savedRecord);
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
      entity.placedAt ?? null,
      entity.currency ?? null,
      (entity.taxTreatment as PriceTaxTreatment | null) ?? null,
      // decimal columns arrive as strings from the pg driver — mirrors
      // ProductRepository's existing `Number(entity.price)` handling.
      entity.totalAmount !== null ? Number(entity.totalAmount) : null,
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
      entity.fxIntendedCurrency ?? null,
      entity.salesDocumentBlockedAt ?? null,
      entity.salesDocumentBlockReleasedAt ?? null,
      // Coerced through the guard rather than cast, for the same reason the two
      // reason columns above are: the column is a plain `varchar`, and a value
      // this build does not recognise must read as "no era" - i.e. the tax-rate
      // guard applies - rather than silently exempting the order from it.
      isTaxRateEra(entity.taxRateEra) ? entity.taxRateEra : null,
      entity.buyerTaxId ?? null
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
   * - The four analytics scalars (#1985) - `placedAt` / `currency` /
   *   `taxTreatment` / `totalAmount` - are mapped by {@link upsertWithLineItems}
   *   directly, NOT here, because this shared conversion also backs
   *   `upsert()`, reached by `persistIncomingSnapshot` with no resolved figure
   *   to offer. Mapping them in this shared method would NULL an
   *   already-`ready` order's analytics figures on every re-poll, and leave
   *   them permanently NULL once item resolution starts failing (see
   *   `upsert()`'s own comment).
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
    // The four analytics scalars (#1985) are deliberately NOT mapped here -
    // see the class comment above and `upsertWithLineItems`, their sole writer.
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

  /**
   * Convert a derived {@link OrderLineItemDraft} to its ORM entity for
   * insertion. `id`/`createdAt` are left for TypeORM to generate.
   */
  private lineItemToOrm(
    orderRecordId: string,
    item: OrderLineItemDraft
  ): OrderLineItemOrmEntity {
    const entity = new OrderLineItemOrmEntity();
    entity.orderRecordId = orderRecordId;
    entity.lineNumber = item.lineNumber;
    entity.productId = item.productId;
    entity.variantId = item.variantId;
    entity.quantity = item.quantity;
    entity.unitPrice = item.unitPrice;
    entity.sourceConnectionId = item.sourceConnectionId;
    entity.placedAt = item.placedAt;
    // #2250 — transcribed verbatim from the snapshot line. This writer owns the
    // whole row (delete-then-reinsert per order), so there is no second writer
    // for these three to race with.
    entity.taxRate = item.taxRate;
    entity.taxSource = item.taxSource;
    entity.taxRateReadAt = item.taxRateReadAt;
    return entity;
  }
}
