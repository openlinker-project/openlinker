/**
 * Order Line Item Repository
 *
 * Read-only repository for `order_line_items` (#1985). The write path lives
 * on `OrderRecordRepository.upsertWithLineItems` (a single transaction with
 * the parent `order_records` row) — this class exists for standalone reads
 * only (tests, future downstream aggregates).
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 * @implements {OrderLineItemRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';
import { In, Repository } from 'typeorm';
import { OrderLineItemOrmEntity } from '../entities/order-line-item.orm-entity';
import { OrderRecordOrmEntity } from '../entities/order-record.orm-entity';
import type { OrderLineItemRepositoryPort } from '../../../domain/ports/order-line-item-repository.port';
import { OrderLineItem } from '../../../domain/entities/order-line-item.entity';
import type {
  ConnectionUnitsSold,
  SalesAnalyticsFilters,
} from '../../../domain/types/order-sales-analytics.types';
import type {
  ProductChannelBreakdownRow,
  ProductRankingRow,
  TopProductFilters,
  VariantChannelBreakdownRow,
  VariantRankingRow,
} from '../../../domain/types/top-products.types';
import { MarginGapReasonValues, type MarginGapReason } from '../../../domain/order-line-cost-snapshot';
import type {
  MarginDailyRow,
  MarginProductFilters,
  MarginProductRow,
  MarginSums,
  MarginVariantRow,
} from '../../../domain/types/order-margin-analytics.types';
import type {
  CostCoverageRawFigures,
  CostCoverageTopVariantRow,
  CostSummary,
  CostWorklistCountFilters,
  CostWorklistFilters,
  CostWorklistRow,
} from '../../../domain/types/cost-coverage.types';
import {
  grossRevenueLineAmountSql,
  netSalesLineNetAmountSql,
  netSalesLineNetEligibleConditionSql,
} from '../../../domain/types/net-sales-tax-rate.types';

/** Raw pg row of the margin SELECT list (numeric columns arrive as strings). */
type MarginRawRow = {
  net_revenue: string;
  covered_net_revenue: string;
  cost_of_goods: string;
  excluded_line_count: string;
} & Record<string, string | null | undefined>;

@Injectable()
export class OrderLineItemRepository implements OrderLineItemRepositoryPort {
  constructor(
    @InjectRepository(OrderLineItemOrmEntity)
    private readonly repository: Repository<OrderLineItemOrmEntity>
  ) {}

  async findByOrderId(orderRecordId: string): Promise<OrderLineItem[]> {
    const entities = await this.repository.find({
      where: { orderRecordId },
      order: { lineNumber: 'ASC' },
    });
    return entities.map((e) => this.toDomain(e));
  }

  async findByOrderIds(orderRecordIds: string[]): Promise<Map<string, OrderLineItem[]>> {
    if (orderRecordIds.length === 0) {
      return new Map();
    }

    // One query for the whole id set — the real batch a cross-cutting read
    // needs, as opposed to an N-call fan-out over `findByOrderId` (#2826).
    const entities = await this.repository.find({
      where: { orderRecordId: In(orderRecordIds) },
      order: { orderRecordId: 'ASC', lineNumber: 'ASC' },
    });

    const grouped = new Map<string, OrderLineItem[]>();
    for (const entity of entities) {
      const lines = grouped.get(entity.orderRecordId) ?? [];
      lines.push(this.toDomain(entity));
      grouped.set(entity.orderRecordId, lines);
    }
    return grouped;
  }

  /**
   * Units sold per source connection (#1987). Joins back to `order_records`
   * only to apply the `recordStatus = 'ready' AND cancelledAt IS NULL` scope
   * — the date-range predicate itself runs against `li."placedAt"`
   * (denormalized from the parent order, #1985).
   *
   * Split into current-era-stamped `units`/unconverted `unconverted_units`
   * on the parent order's `reportingCurrency` (#1987 review, IMPORTANT 1 —
   * see the port's JSDoc for why this must match `orderCount`/`revenue`'s
   * population rather than counting every non-cancelled line).
   */
  async getUnitsSoldByConnection(
    filters: SalesAnalyticsFilters,
    currentReportingCurrency: string
  ): Promise<Map<string, ConnectionUnitsSold>> {
    const isStamped = 'rec."reportingCurrency" = :currentReportingCurrency';
    const isUnconverted =
      '(rec."reportingCurrency" IS NULL OR rec."reportingCurrency" != :currentReportingCurrency)';

    const qb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .select('li.sourceConnectionId', 'source_connection_id')
      .addSelect(`COALESCE(SUM(li."quantity") FILTER (WHERE ${isStamped}), 0)`, 'units')
      .addSelect(
        `COALESCE(SUM(li."quantity") FILTER (WHERE ${isUnconverted}), 0)`,
        'unconverted_units'
      )
      .where(`rec."recordStatus" = 'ready'`)
      .andWhere('rec."cancelledAt" IS NULL')
      // `totalAmount IS NOT NULL` aligns this read's population with the two
      // order-level scopes (#2668 review, SUGGESTION 11). Both
      // `applySalesAnalyticsScope` and `applyTopProductsScope` apply it, so
      // without it an order with no resolvable total contributed units to the
      // channel table while contributing neither an order nor revenue beside
      // them — three predicates meant to describe ONE population, which is
      // exactly what this method's own docblock says it keeps in agreement.
      // `rec."placedAt" IS NOT NULL` is deliberately still not repeated: the
      // `li."placedAt"` range predicate below already excludes a NULL, since
      // that column is denormalized from the parent order at write time.
      .andWhere('rec."totalAmount" IS NOT NULL')
      .andWhere('li."placedAt" >= :salesFrom', { salesFrom: filters.from })
      .andWhere('li."placedAt" < :salesTo', { salesTo: filters.to })
      .setParameter('currentReportingCurrency', currentReportingCurrency)
      .groupBy('li.sourceConnectionId');

    if (filters.sourceConnectionId) {
      qb.andWhere('li.sourceConnectionId = :salesConnectionId', {
        salesConnectionId: filters.sourceConnectionId,
      });
    }

    const rows = await qb.getRawMany<{
      source_connection_id: string;
      units: string;
      unconverted_units: string;
    }>();
    return new Map(
      rows.map((row) => [
        row.source_connection_id,
        { unitsSold: Number(row.units), unconvertedUnitsSold: Number(row.unconverted_units) },
      ])
    );
  }

  /**
   * Products ranked by revenue or units, paged (#1988). Per-line reporting-
   * currency revenue is derived from the parent order's own implicit FX
   * multiplier (`reportingTotalAmount / totalAmount`, both already on the
   * joined `order_records` row) rather than a second join into the currency
   * context — see the #1988 implementation plan § 4 for why this is exact,
   * not an approximation. Runs the page query and the total-count query in
   * parallel; the count query shares the same scope but no grouping/paging.
   *
   * `reportingCurrency` is scoped to the CURRENT system reporting currency
   * (#2049/ADR-040 bugfix): a row's `reportingCurrency` is pinned forever at
   * first-stamp time, so an order stamped under a PREVIOUS setting is a
   * different currency era and must not be summed into `revenue` alongside
   * current-era orders under one arbitrary label — it is folded into
   * `unconvertedRevenue`/`unconvertedOrderCount` instead, exactly like a
   * never-stamped order. `unconvertedCurrency` labels that evidence with the
   * one native currency shared by every such order, or `null` when the set
   * mixes currencies — same "null if mixed" rule
   * `OrderRecordRepositoryPort.getDailyOrderAggregates` uses for its own
   * `unconvertedCurrency`. The label guard also requires zero NULL
   * `rec."currency"` rows in the filtered set (#2172 review, SUGGESTION 3):
   * `COUNT(DISTINCT ...)` alone ignores NULLs, so a set of `{NULL, 'PLN'}`
   * would otherwise count one distinct value and mislabel the mix as `PLN`.
   *
   * A stamped order with `totalAmount = 0` (fully discounted / free) also
   * folds into the unconverted bucket (#2172 review, IMPORTANT 2): the FX
   * multiplier `reportingTotalAmount / totalAmount` is `NULL` via
   * `NULLIF(totalAmount, 0)`, so without this guard the line's revenue would
   * silently vanish from *both* `revenue` and `unconvertedRevenue` — exactly
   * the silent-drop #1988's own AC forbids. Its native-currency line amount
   * is disclosed instead, same as a never-stamped order.
   *
   * `ORDER BY` carries an explicit `product_id` tiebreaker (#2172 review,
   * IMPORTANT 1): `revenue`/`units` are not unique, so pagination over a
   * non-unique sort with no secondary key is non-deterministic in Postgres —
   * ties can be repeated on one page and skipped on the next.
   */
  async getTopProductRanking(
    filters: TopProductFilters,
    reportingCurrency: string,
    includeBackfilledPreRollout = false
  ): Promise<{ rows: ProductRankingRow[]; total: number }> {
    const {
      stampedNonZero,
      unconvertedOrZeroTotal,
      lineGrossAmount,
      lineNetAmount,
      stampedNonZeroKnownRate,
      stampedNonZeroUnknownRate,
    } = this.buildTopProductsSqlFragments(includeBackfilledPreRollout);

    const rankingQb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .select('li.productId', 'product_id')
      .addSelect('COALESCE(SUM(li."quantity"), 0)', 'units')
      .addSelect(
        `COALESCE(SUM((${lineGrossAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZero}), 0)`,
        'revenue'
      )
      .addSelect(
        `COALESCE(SUM(${lineGrossAmount}) FILTER (WHERE ${unconvertedOrZeroTotal}), 0)`,
        'unconverted_revenue'
      )
      .addSelect(
        `COUNT(DISTINCT li."orderRecordId") FILTER (WHERE ${unconvertedOrZeroTotal})`,
        'unconverted_order_count'
      )
      .addSelect(
        `CASE WHEN COUNT(*) FILTER (WHERE ${stampedNonZero}) > 0 THEN :reportingCurrency ELSE NULL END`,
        'reporting_currency'
      )
      .addSelect(
        `CASE WHEN COUNT(DISTINCT rec."currency") FILTER (WHERE ${unconvertedOrZeroTotal}) <= 1
              AND COUNT(*) FILTER (WHERE ${unconvertedOrZeroTotal} AND rec."currency" IS NULL) = 0
              THEN MAX(rec."currency") FILTER (WHERE ${unconvertedOrZeroTotal})
              ELSE NULL END`,
        'unconverted_currency'
      )
      .addSelect(
        `COALESCE(SUM((${lineNetAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZeroKnownRate}), 0)`,
        'net_revenue'
      )
      .addSelect(
        `COALESCE(SUM((${lineGrossAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZeroUnknownRate}), 0)`,
        'net_excluded_revenue'
      )
      .addSelect(`COUNT(*) FILTER (WHERE ${stampedNonZeroUnknownRate})`, 'net_excluded_line_count')
      .setParameter('reportingCurrency', reportingCurrency)
      .groupBy('li.productId')
      .orderBy(filters.sortBy === 'units' ? 'units' : 'revenue', 'DESC')
      .addOrderBy('product_id', 'ASC')
      .limit(filters.limit)
      .offset(filters.offset);
    this.applyTopProductsScope(rankingQb, filters);

    const totalQb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .select('COUNT(DISTINCT li."productId")', 'total');
    this.applyTopProductsScope(totalQb, filters);

    const [rankingRows, totalRow] = await Promise.all([
      rankingQb.getRawMany<{
        product_id: string;
        units: string;
        revenue: string;
        unconverted_revenue: string;
        unconverted_order_count: string;
        reporting_currency: string | null;
        unconverted_currency: string | null;
        net_revenue: string;
        net_excluded_revenue: string;
        net_excluded_line_count: string;
      }>(),
      totalQb.getRawOne<{ total: string }>(),
    ]);

    return {
      rows: rankingRows.map((row) => ({
        productId: row.product_id,
        units: Number(row.units),
        revenue: Number(row.revenue),
        unconvertedRevenue: Number(row.unconverted_revenue),
        unconvertedOrderCount: Number(row.unconverted_order_count),
        currency: row.reporting_currency,
        unconvertedCurrency: row.unconverted_currency,
        netRevenue: Number(row.net_revenue),
        netExcludedRevenue: Number(row.net_excluded_revenue),
        netExcludedLineCount: Number(row.net_excluded_line_count),
      })),
      total: Number(totalRow?.total ?? 0),
    };
  }

  /**
   * Per-(product, connection) breakdown for an explicit, already-paged set of
   * product ids (#1988) — callers MUST bound `productIds` to the current
   * page; this method does not itself limit or rank. `reportingCurrency` is
   * scoped to the CURRENT system reporting currency — same meaning and same
   * #2049/ADR-040 bugfix as {@link getTopProductRanking}. Also shares that
   * method's `totalAmount = 0` fold into the unconverted bucket (#2172
   * review, IMPORTANT 2) — see its doc comment.
   *
   * `unconvertedCurrency` is computed per (product, connection), not
   * inherited from the parent ranking row (#2172 review, still-open
   * follow-up): the parent goes `null` whenever the full mixed-channel set
   * disagrees on native currency, but one channel's own subset is routinely
   * single-currency even then, so it is strictly more labelable than the
   * product as a whole — never less.
   */
  async getProductChannelBreakdown(
    productIds: string[],
    filters: SalesAnalyticsFilters,
    reportingCurrency: string,
    includeBackfilledPreRollout = false
  ): Promise<ProductChannelBreakdownRow[]> {
    if (productIds.length === 0) {
      return [];
    }

    const {
      stampedNonZero,
      unconvertedOrZeroTotal,
      lineGrossAmount,
      lineNetAmount,
      stampedNonZeroKnownRate,
      stampedNonZeroUnknownRate,
    } = this.buildTopProductsSqlFragments(includeBackfilledPreRollout);

    const qb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .select('li.productId', 'product_id')
      .addSelect('li.sourceConnectionId', 'source_connection_id')
      .addSelect('COALESCE(SUM(li."quantity"), 0)', 'units')
      .addSelect(
        `COALESCE(SUM((${lineGrossAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZero}), 0)`,
        'revenue'
      )
      .addSelect(
        `COALESCE(SUM(${lineGrossAmount}) FILTER (WHERE ${unconvertedOrZeroTotal}), 0)`,
        'unconverted_revenue'
      )
      .addSelect(
        `CASE WHEN COUNT(*) FILTER (WHERE ${stampedNonZero}) > 0 THEN :reportingCurrency ELSE NULL END`,
        'reporting_currency'
      )
      .addSelect(
        `CASE WHEN COUNT(DISTINCT rec."currency") FILTER (WHERE ${unconvertedOrZeroTotal}) <= 1
              AND COUNT(*) FILTER (WHERE ${unconvertedOrZeroTotal} AND rec."currency" IS NULL) = 0
              THEN MAX(rec."currency") FILTER (WHERE ${unconvertedOrZeroTotal})
              ELSE NULL END`,
        'unconverted_currency'
      )
      .addSelect(
        `COALESCE(SUM((${lineNetAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZeroKnownRate}), 0)`,
        'net_revenue'
      )
      .addSelect(
        `COALESCE(SUM((${lineGrossAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZeroUnknownRate}), 0)`,
        'net_excluded_revenue'
      )
      .addSelect(`COUNT(*) FILTER (WHERE ${stampedNonZeroUnknownRate})`, 'net_excluded_line_count')
      .setParameter('reportingCurrency', reportingCurrency)
      .andWhere('li."productId" IN (:...productIds)', { productIds })
      .groupBy('li.productId')
      .addGroupBy('li.sourceConnectionId');
    this.applyTopProductsScope(qb, filters);

    const rows = await qb.getRawMany<{
      product_id: string;
      source_connection_id: string;
      units: string;
      revenue: string;
      unconverted_revenue: string;
      reporting_currency: string | null;
      unconverted_currency: string | null;
      net_revenue: string;
      net_excluded_revenue: string;
      net_excluded_line_count: string;
    }>();

    return rows.map((row) => ({
      productId: row.product_id,
      sourceConnectionId: row.source_connection_id,
      units: Number(row.units),
      revenue: Number(row.revenue),
      unconvertedRevenue: Number(row.unconverted_revenue),
      currency: row.reporting_currency,
      unconvertedCurrency: row.unconverted_currency,
      netRevenue: Number(row.net_revenue),
      netExcludedRevenue: Number(row.net_excluded_revenue),
      netExcludedLineCount: Number(row.net_excluded_line_count),
    }));
  }

  /**
   * One product's variants ranked across every channel (#2765) — the
   * variant-scoped counterpart to {@link getTopProductRanking}, grouped by
   * `li.variantId` instead of `li.productId` and pre-filtered to one
   * product. No pagination/sort: a product's variant count is small and
   * catalog-bounded, unlike the full product catalog {@link
   * getTopProductRanking} pages over.
   *
   * No new index is needed for this read or for {@link
   * getVariantChannelBreakdown} (#2766 review, finding 7). Both filter on
   * `li."productId"` plus the `placedAt` range, which is exactly the
   * leading-column shape the pre-existing `IDX(productId, placedAt)` on
   * `order_line_items` serves; `variantId` / `sourceConnectionId` appear
   * only as GROUP BY keys, never in a predicate, so a `(productId,
   * variantId)` index would add write cost and change no plan. Hence no
   * migration ships with this change.
   */
  async getVariantRanking(
    productId: string,
    filters: SalesAnalyticsFilters,
    reportingCurrency: string
  ): Promise<VariantRankingRow[]> {
    const {
      stampedNonZero,
      unconvertedOrZeroTotal,
      lineGrossAmount,
      lineNetAmount,
      stampedNonZeroKnownRate,
      stampedNonZeroUnknownRate,
    } = this.buildTopProductsSqlFragments();

    const qb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .select('li.variantId', 'variant_id')
      .addSelect('COALESCE(SUM(li."quantity"), 0)', 'units')
      .addSelect(
        `COALESCE(SUM((${lineGrossAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZero}), 0)`,
        'revenue'
      )
      .addSelect(
        `COALESCE(SUM(${lineGrossAmount}) FILTER (WHERE ${unconvertedOrZeroTotal}), 0)`,
        'unconverted_revenue'
      )
      .addSelect(
        `COUNT(DISTINCT li."orderRecordId") FILTER (WHERE ${unconvertedOrZeroTotal})`,
        'unconverted_order_count'
      )
      .addSelect(
        `CASE WHEN COUNT(*) FILTER (WHERE ${stampedNonZero}) > 0 THEN :reportingCurrency ELSE NULL END`,
        'reporting_currency'
      )
      .addSelect(
        `CASE WHEN COUNT(DISTINCT rec."currency") FILTER (WHERE ${unconvertedOrZeroTotal}) <= 1
              AND COUNT(*) FILTER (WHERE ${unconvertedOrZeroTotal} AND rec."currency" IS NULL) = 0
              THEN MAX(rec."currency") FILTER (WHERE ${unconvertedOrZeroTotal})
              ELSE NULL END`,
        'unconverted_currency'
      )
      .addSelect(
        `COALESCE(SUM((${lineNetAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZeroKnownRate}), 0)`,
        'net_revenue'
      )
      .addSelect(
        `COALESCE(SUM((${lineGrossAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZeroUnknownRate}), 0)`,
        'net_excluded_revenue'
      )
      .addSelect(`COUNT(*) FILTER (WHERE ${stampedNonZeroUnknownRate})`, 'net_excluded_line_count')
      .setParameter('reportingCurrency', reportingCurrency)
      .andWhere('li."productId" = :productId', { productId })
      .groupBy('li.variantId')
      // Postgres returns `HashAggregate` output in unspecified order, so
      // without this the "ranking" was nondeterministic — two identical
      // requests could hand the panel its rows in different orders, and the
      // null-variant "Unassigned" bucket could land mid-list (#2765 review,
      // finding 2). Mirrors the product-level twin's ordering, with the
      // `variantId` tiebreak pinned NULLS LAST so the Unassigned bucket is
      // always at the edge rather than between two real variants.
      .orderBy('revenue', 'DESC')
      .addOrderBy('variant_id', 'ASC', 'NULLS LAST');
    this.applyTopProductsScope(qb, filters);

    const rows = await qb.getRawMany<{
      variant_id: string | null;
      units: string;
      revenue: string;
      unconverted_revenue: string;
      unconverted_order_count: string;
      reporting_currency: string | null;
      unconverted_currency: string | null;
      net_revenue: string;
      net_excluded_revenue: string;
      net_excluded_line_count: string;
    }>();

    return rows.map((row) => ({
      variantId: row.variant_id,
      units: Number(row.units),
      revenue: Number(row.revenue),
      unconvertedRevenue: Number(row.unconverted_revenue),
      unconvertedOrderCount: Number(row.unconverted_order_count),
      currency: row.reporting_currency,
      unconvertedCurrency: row.unconverted_currency,
      netRevenue: Number(row.net_revenue),
      netExcludedRevenue: Number(row.net_excluded_revenue),
      netExcludedLineCount: Number(row.net_excluded_line_count),
    }));
  }

  /**
   * Per-channel breakdown of one product's variants (#2765) — the
   * variant-scoped counterpart to {@link getProductChannelBreakdown}, grouped
   * by `(li.variantId, li.sourceConnectionId)` and pre-filtered to one
   * product instead of an explicit page of product ids.
   */
  async getVariantChannelBreakdown(
    productId: string,
    filters: SalesAnalyticsFilters,
    reportingCurrency: string
  ): Promise<VariantChannelBreakdownRow[]> {
    const {
      stampedNonZero,
      unconvertedOrZeroTotal,
      lineGrossAmount,
      lineNetAmount,
      stampedNonZeroKnownRate,
      stampedNonZeroUnknownRate,
    } = this.buildTopProductsSqlFragments();

    const qb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .select('li.variantId', 'variant_id')
      .addSelect('li.sourceConnectionId', 'source_connection_id')
      .addSelect('COALESCE(SUM(li."quantity"), 0)', 'units')
      .addSelect(
        `COALESCE(SUM((${lineGrossAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZero}), 0)`,
        'revenue'
      )
      .addSelect(
        `COALESCE(SUM(${lineGrossAmount}) FILTER (WHERE ${unconvertedOrZeroTotal}), 0)`,
        'unconverted_revenue'
      )
      .addSelect(
        `CASE WHEN COUNT(*) FILTER (WHERE ${stampedNonZero}) > 0 THEN :reportingCurrency ELSE NULL END`,
        'reporting_currency'
      )
      .addSelect(
        `CASE WHEN COUNT(DISTINCT rec."currency") FILTER (WHERE ${unconvertedOrZeroTotal}) <= 1
              AND COUNT(*) FILTER (WHERE ${unconvertedOrZeroTotal} AND rec."currency" IS NULL) = 0
              THEN MAX(rec."currency") FILTER (WHERE ${unconvertedOrZeroTotal})
              ELSE NULL END`,
        'unconverted_currency'
      )
      .addSelect(
        `COALESCE(SUM((${lineNetAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZeroKnownRate}), 0)`,
        'net_revenue'
      )
      .addSelect(
        `COALESCE(SUM((${lineGrossAmount}) * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZeroUnknownRate}), 0)`,
        'net_excluded_revenue'
      )
      .addSelect(`COUNT(*) FILTER (WHERE ${stampedNonZeroUnknownRate})`, 'net_excluded_line_count')
      .setParameter('reportingCurrency', reportingCurrency)
      .andWhere('li."productId" = :productId', { productId })
      .groupBy('li.variantId')
      .addGroupBy('li.sourceConnectionId')
      // The matrix indexes these rows by connection id, so their order does
      // not decide what it renders today — but an unordered aggregate read is
      // one refactor away from mattering, and determinism costs nothing here.
      // Same reasoning (and same key order) as `getVariantRanking`'s own
      // ordering above (#2766 review, finding 6).
      .orderBy('variant_id', 'ASC', 'NULLS LAST')
      .addOrderBy('source_connection_id', 'ASC');
    this.applyTopProductsScope(qb, filters);

    const rows = await qb.getRawMany<{
      variant_id: string | null;
      source_connection_id: string;
      units: string;
      revenue: string;
      unconverted_revenue: string;
      reporting_currency: string | null;
      unconverted_currency: string | null;
      net_revenue: string;
      net_excluded_revenue: string;
      net_excluded_line_count: string;
    }>();

    return rows.map((row) => ({
      variantId: row.variant_id,
      sourceConnectionId: row.source_connection_id,
      units: Number(row.units),
      revenue: Number(row.revenue),
      unconvertedRevenue: Number(row.unconverted_revenue),
      currency: row.reporting_currency,
      unconvertedCurrency: row.unconverted_currency,
      netRevenue: Number(row.net_revenue),
      netExcludedRevenue: Number(row.net_excluded_revenue),
      netExcludedLineCount: Number(row.net_excluded_line_count),
    }));
  }

  /**
   * The `#stampedNonZero`/`#unconvertedOrZeroTotal`/net-sales SQL fragments
   * shared by every #1988/#2765 top-products read (product- and
   * variant-grained alike) — extracted (#2765 review) so a fourth near-
   * identical copy wasn't pasted alongside the product-level pair. Every
   * fragment is parameter-name-only (`:reportingCurrency`); the actual value
   * is bound once per query via `.setParameter(...)`, so this needs none.
   */
  private buildTopProductsSqlFragments(includeBackfilledPreRollout = false): {
    stampedNonZero: string;
    unconvertedOrZeroTotal: string;
    lineGrossAmount: string;
    lineNetAmount: string;
    stampedNonZeroKnownRate: string;
    stampedNonZeroUnknownRate: string;
  } {
    const stampedNonZero = 'rec."reportingCurrency" = :reportingCurrency AND rec."totalAmount" <> 0';
    // Parenthesized even though it's the only clause needing it today —
    // this constant is later spliced into `${unconvertedOrZeroTotal} AND
    // rec."currency" IS NULL`, and SQL's AND-before-OR precedence silently
    // turned that into `X OR (Y AND Z)` instead of the intended `(X OR Y)
    // AND Z` when this was a bare, unparenthesized OR (#2172 review — this
    // is what actually broke `unconverted_currency`, always falling to
    // NULL whenever any row's reportingCurrency mismatched).
    const unconvertedOrZeroTotal =
      '(rec."reportingCurrency" IS DISTINCT FROM :reportingCurrency OR rec."totalAmount" = 0)';

    // GROSS (VAT-inclusive) amount for a LINE — the exact helper #2892 moved
    // the headline GMV onto and #2906 moved the gross median onto (#2668
    // review, BLOCKING 1). This file previously used a raw
    // `li."unitPrice" * li."quantity"`, which is the NET figure whenever the
    // parent order is net-priced: `prestashop-order.mapper.ts` and
    // `woocommerce-order-source.adapter.ts` both emit
    // `taxTreatment: 'exclusive'`, i.e. two of the four shipped order sources
    // and typically a merchant's primary channel. The result was the Top
    // Products table reporting an un-grossed figure directly beneath a KPI
    // strip reporting a grossed-up one, both labelled the same basis — a
    // ~23% divergence between two numbers on one page, which is precisely the
    // symptom #2908 was opened for. Net mode was always correct, so the bug
    // was toggle-dependent and easy to miss.
    const lineGrossAmount = grossRevenueLineAmountSql(
      'li."unitPrice"',
      'li."quantity"',
      'li."taxRate"',
      'rec."taxTreatment"'
    );

    // Net-sales (VAT-exclusive) eligibility for a LINE — this read already
    // operates at line grain, so unlike #1987's order-level aggregates no
    // correlated subquery is needed: the rate fraction is read directly off
    // this row's own `li."taxRate"`, unless the order is net-priced.
    const lineNetAmount = netSalesLineNetAmountSql(
      'li."unitPrice"',
      'li."quantity"',
      'li."taxRate"',
      'rec."taxTreatment"'
    );
    const netEligibleCondition = netSalesLineNetEligibleConditionSql(
      'li."taxRate"',
      'rec."taxTreatment"',
      includeBackfilledPreRollout
    );

    return {
      stampedNonZero,
      unconvertedOrZeroTotal,
      lineGrossAmount,
      lineNetAmount,
      stampedNonZeroKnownRate: `${stampedNonZero} AND ${netEligibleCondition}`,
      stampedNonZeroUnknownRate: `${stampedNonZero} AND NOT ${netEligibleCondition}`,
    };
  }

  /**
   * Shared scope for the #1988 top-products reads: only `'ready'` records
   * (via the join), not cancelled, with a resolvable `totalAmount`, within
   * `[filters.from, filters.to)` on `li."placedAt"`, optionally narrowed to
   * one connection — mirrors {@link getUnitsSoldByConnection}'s inline
   * predicates and `OrderRecordRepository.applySalesAnalyticsScope`'s
   * semantics (#2172 review, IMPORTANT 1: the two are kept in agreement on
   * what counts as "an order in scope" so a row counted here is never
   * excluded from #1987's channel totals, or vice versa). `rec."placedAt" IS
   * NOT NULL` is NOT repeated here — `li."placedAt"` is denormalized from the
   * parent order at write time (#1985), so the `>= / <` range predicate below
   * already excludes a NULL the same way `applySalesAnalyticsScope`'s
   * explicit guard does on the parent column.
   */
  private applyTopProductsScope(
    qb: SelectQueryBuilder<OrderLineItemOrmEntity>,
    filters: SalesAnalyticsFilters
  ): void {
    qb.andWhere(`rec."recordStatus" = 'ready'`)
      .andWhere('rec."cancelledAt" IS NULL')
      .andWhere('rec."totalAmount" IS NOT NULL')
      .andWhere('li."placedAt" >= :salesFrom', { salesFrom: filters.from })
      .andWhere('li."placedAt" < :salesTo', { salesTo: filters.to });

    if (filters.sourceConnectionId) {
      qb.andWhere('li.sourceConnectionId = :salesConnectionId', {
        salesConnectionId: filters.sourceConnectionId,
      });
    }
  }

  /**
   * Margin by UTC day x source connection (#3588, D27). Gross margin on NET
   * revenue: the net-revenue population is exactly the top-products NET figure's
   * (`stampedNonZeroKnownRate`: stamped in the current reporting currency,
   * non-zero total, net-eligible), so margin `netRevenue` equals that figure
   * for the same range (G11-E, no returns subtraction).
   *
   * Cross-context table join (ADR-036): `product_variants` is owned by
   * `products` and is LEFT JOINed by table name purely to tell a line whose
   * variant has since been given a cost (`cost-entered-after-sale`) from one
   * whose variant has none (`no-cost`). It never feeds a figure - cost comes
   * from the snapshot columns on the line itself, so a later cost edit cannot
   * move an earlier margin.
   */
  async getMarginDailyRows(
    filters: SalesAnalyticsFilters,
    reportingCurrency: string,
    includeBackfilledPreRollout = false
  ): Promise<MarginDailyRow[]> {
    const qb = this.createMarginQuery(reportingCurrency, includeBackfilledPreRollout)
      .addSelect(`to_char(li."placedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD')`, 'day')
      .addSelect('li."sourceConnectionId"', 'source_connection_id')
      .groupBy('day')
      .addGroupBy('li."sourceConnectionId"')
      .orderBy('day', 'ASC')
      .addOrderBy('source_connection_id', 'ASC');
    this.applyTopProductsScope(qb, filters);

    const rows = await qb.getRawMany<MarginRawRow & { day: string; source_connection_id: string }>();
    return rows.map((row) => ({
      day: row.day,
      sourceConnectionId: row.source_connection_id,
      ...this.toMarginSums(row),
    }));
  }

  /** Margin ranked by product (#3588); `total` is the distinct product count in scope before paging. */
  async getMarginProductRanking(
    filters: MarginProductFilters,
    reportingCurrency: string,
    includeBackfilledPreRollout = false
  ): Promise<{ rows: MarginProductRow[]; total: number }> {
    const qb = this.createMarginQuery(reportingCurrency, includeBackfilledPreRollout)
      .addSelect('li."productId"', 'product_id')
      .groupBy('li."productId"');

    if (filters.sortBy === 'marginPct') {
      qb.orderBy('margin_pct', 'DESC', 'NULLS LAST');
    } else {
      qb.orderBy(filters.sortBy === 'grossMargin' ? 'gross_margin' : 'net_revenue', 'DESC');
    }
    qb.addOrderBy('product_id', 'ASC').limit(filters.limit).offset(filters.offset);
    this.applyTopProductsScope(qb, filters);

    const totalQb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .select('COUNT(DISTINCT li."productId")', 'total');
    this.applyTopProductsScope(totalQb, filters);

    const [rows, totalRow] = await Promise.all([
      qb.getRawMany<MarginRawRow & { product_id: string }>(),
      totalQb.getRawOne<{ total: string }>(),
    ]);

    return {
      rows: rows.map((row) => ({ productId: row.product_id, ...this.toMarginSums(row) })),
      total: Number(totalRow?.total ?? 0),
    };
  }

  /** One product's margin split by variant (#3588); `variantId: null` = lines that never resolved to a variant. */
  async getMarginVariantRows(
    productId: string,
    filters: SalesAnalyticsFilters,
    reportingCurrency: string,
    includeBackfilledPreRollout = false
  ): Promise<MarginVariantRow[]> {
    const qb = this.createMarginQuery(reportingCurrency, includeBackfilledPreRollout)
      .addSelect('li."variantId"', 'variant_id')
      .andWhere('li."productId" = :marginProductId', { marginProductId: productId })
      .groupBy('li."variantId"')
      .orderBy('net_revenue', 'DESC')
      .addOrderBy('variant_id', 'ASC', 'NULLS LAST');
    this.applyTopProductsScope(qb, filters);

    const rows = await qb.getRawMany<MarginRawRow & { variant_id: string | null }>();
    return rows.map((row) => ({ variantId: row.variant_id, ...this.toMarginSums(row) }));
  }

  /**
   * Lines that are in net revenue but carry no usable cost - the no-cost Data
   * Coverage count (G11-D counts LINES, not orders). Same predicate as the sum
   * of every margin gap bucket, so the coverage count and the margin gaps can
   * never disagree.
   */
  async countUncoveredLines(
    filters: SalesAnalyticsFilters,
    reportingCurrency: string,
    includeBackfilledPreRollout = false
  ): Promise<number> {
    const { inRevenue, covered } = this.buildMarginSqlFragments(includeBackfilledPreRollout);
    const qb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .select(`COUNT(*) FILTER (WHERE ${inRevenue} AND NOT (${covered}))`, 'uncovered')
      .setParameter('reportingCurrency', reportingCurrency);
    this.applyTopProductsScope(qb, filters);
    const row = await qb.getRawOne<{ uncovered: string }>();
    return Number(row?.uncovered ?? 0);
  }

  /**
   * Cost coverage of a window (#3588). Same net-revenue population as the
   * margin reads (`inRevenue`), and the gap split is the margin classification
   * itself, so `sum(gaps) + covered = netSales` holds here too. "Without cost"
   * is the variant's CURRENT state (`pv."netUnitCost" IS NULL`, non-stale
   * variants only so the figures match the work list's `sold` tab).
   *
   * Cross-context table join (ADR-036): `product_variants` belongs to
   * `products`; read by table name, never written, and the line's own snapshot
   * stays the only source of any margin figure.
   */
  async getCostCoverageFigures(
    filters: SalesAnalyticsFilters,
    reportingCurrency: string,
    includeBackfilledPreRollout = false
  ): Promise<CostCoverageRawFigures> {
    const { inRevenue, netAmount, gapConditions } =
      this.buildMarginSqlFragments(includeBackfilledPreRollout);
    const soldVariant = `${inRevenue} AND ${this.liveVariantCondition()}`;
    const withoutCost = `${soldVariant} AND pv."netUnitCost" IS NULL`;

    const qb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .leftJoin('product_variants', 'pv', 'pv."id" = li."variantId"')
      .select(`COUNT(DISTINCT li."variantId") FILTER (WHERE ${soldVariant})`, 'sold_variants')
      .addSelect(
        `COUNT(DISTINCT li."variantId") FILTER (WHERE ${withoutCost})`,
        'sold_without_cost'
      )
      .addSelect(`COALESCE(SUM(${netAmount}) FILTER (WHERE ${inRevenue}), 0)`, 'net_sales')
      .addSelect(
        `COALESCE(SUM(${netAmount}) FILTER (WHERE ${withoutCost}), 0)`,
        'net_sales_without_cost'
      )
      .addSelect(
        `COALESCE(SUM(${netAmount}) FILTER (WHERE ${inRevenue} AND li."variantId" IS NULL), 0)`,
        'product_only_net_sales'
      )
      .setParameter('reportingCurrency', reportingCurrency);
    for (const reason of MarginGapReasonValues) {
      const alias = reason.replace(/-/g, '_');
      qb.addSelect(`COUNT(*) FILTER (WHERE ${gapConditions[reason]})`, `gap_${alias}_lines`).addSelect(
        `COALESCE(SUM(${netAmount}) FILTER (WHERE ${gapConditions[reason]}), 0)`,
        `gap_${alias}_net`
      );
    }
    this.applyTopProductsScope(qb, filters);

    const row = await qb.getRawOne<Record<string, string | null>>();
    return {
      soldVariantCount: Number(row?.sold_variants ?? 0),
      soldVariantsWithoutCost: Number(row?.sold_without_cost ?? 0),
      netSales: Number(row?.net_sales ?? 0),
      netSalesWithoutCost: Number(row?.net_sales_without_cost ?? 0),
      productOnlyNetSales: Number(row?.product_only_net_sales ?? 0),
      gaps: MarginGapReasonValues.map((reason) => {
        const alias = reason.replace(/-/g, '_');
        return {
          reason,
          lineCount: Number(row?.[`gap_${alias}_lines`] ?? 0),
          netAmount: Number(row?.[`gap_${alias}_net`] ?? 0),
        };
      }),
    };
  }

  async getTopVariantsWithoutCost(
    filters: SalesAnalyticsFilters,
    reportingCurrency: string,
    limit: number,
    includeBackfilledPreRollout = false
  ): Promise<CostCoverageTopVariantRow[]> {
    const { inRevenue, netAmount } = this.buildMarginSqlFragments(includeBackfilledPreRollout);
    const qb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .leftJoin('product_variants', 'pv', 'pv."id" = li."variantId"')
      .select('li."variantId"', 'variant_id')
      .addSelect('MIN(li."productId")', 'product_id')
      .addSelect(`COALESCE(SUM(${netAmount}), 0)`, 'net_sales')
      .where(`${inRevenue} AND ${this.liveVariantCondition()} AND pv."netUnitCost" IS NULL`)
      .groupBy('li."variantId"')
      .orderBy('net_sales', 'DESC')
      .addOrderBy('variant_id', 'ASC')
      .limit(limit)
      .setParameter('reportingCurrency', reportingCurrency);
    this.applyTopProductsScope(qb, filters);

    const rows = await qb.getRawMany<{ variant_id: string; product_id: string; net_sales: string }>();
    return rows.map((row) => ({
      variantId: row.variant_id,
      productId: row.product_id,
      netSales: Number(row.net_sales),
    }));
  }

  async findCostWorklistRows(
    filters: CostWorklistFilters,
    salesWindow: SalesAnalyticsFilters,
    reportingCurrency: string,
    includeBackfilledPreRollout = false
  ): Promise<CostWorklistRow[]> {
    const qb = this.buildCostWorklistQuery(
      filters,
      salesWindow,
      reportingCurrency,
      includeBackfilledPreRollout
    )
      .select('pv."id"', 'variant_id')
      .addSelect('pv."productId"', 'product_id')
      .addSelect('p."name"', 'product_name')
      .addSelect('pv."sku"', 'sku')
      .addSelect('pv."attributes"', 'attributes')
      .addSelect('pv."netUnitCost"', 'net_unit_cost')
      .addSelect('pv."costCurrency"', 'cost_currency')
      .addSelect('pv."costUpdatedAt"', 'cost_updated_at')
      .addSelect('COALESCE(s."net_sales", 0)', 'net_sales')
      .addSelect('COALESCE(s."units", 0)', 'units')
      .addSelect('s."connection_ids"', 'connection_ids');

    if (filters.tab === 'has-cost') {
      qb.orderBy('pv."costUpdatedAt"', 'DESC', 'NULLS LAST').addOrderBy('pv."id"', 'ASC');
    } else {
      qb.orderBy('net_sales', 'DESC')
        .addOrderBy('pv."sku"', 'ASC', 'NULLS LAST')
        .addOrderBy('pv."id"', 'ASC');
    }
    qb.limit(filters.limit).offset(filters.offset);

    const rows = await qb.getRawMany<{
      variant_id: string;
      product_id: string;
      product_name: string;
      sku: string | null;
      attributes: Record<string, string> | null;
      net_unit_cost: string | null;
      cost_currency: string | null;
      cost_updated_at: Date | null;
      net_sales: string;
      units: string;
      connection_ids: string[] | null;
    }>();
    return rows.map((row) => ({
      variantId: row.variant_id,
      productId: row.product_id,
      productName: row.product_name,
      sku: row.sku,
      attributes: row.attributes,
      netUnitCost: row.net_unit_cost,
      costCurrency: row.cost_currency,
      costUpdatedAt: row.cost_updated_at,
      netSales30d: Number(row.net_sales),
      units30d: Number(row.units),
      soldOnConnectionIds: row.connection_ids ?? [],
    }));
  }

  async countCostWorklist(
    filters: CostWorklistCountFilters,
    salesWindow: SalesAnalyticsFilters,
    reportingCurrency: string,
    includeBackfilledPreRollout = false
  ): Promise<number> {
    const row = await this.buildCostWorklistQuery(
      filters,
      salesWindow,
      reportingCurrency,
      includeBackfilledPreRollout
    )
      .select('COUNT(*)', 'total')
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  async getCostSummary(): Promise<CostSummary> {
    // ADR-036: read-only table-name read of `product_variants`, owned by `products`.
    const row = await this.repository.manager
      .createQueryBuilder()
      .from('product_variants', 'pv')
      .select('COUNT(*) FILTER (WHERE pv."netUnitCost" IS NULL)', 'variants_without_cost')
      .addSelect(
        'COUNT(DISTINCT pv."productId") FILTER (WHERE pv."netUnitCost" IS NULL)',
        'products_without_cost'
      )
      .addSelect('COUNT(*) FILTER (WHERE pv."netUnitCost" IS NOT NULL)', 'variants_with_cost')
      .where('pv."isStale" = false')
      .getRawOne<{
        variants_without_cost: string;
        products_without_cost: string;
        variants_with_cost: string;
      }>();
    return {
      variantsWithoutCost: Number(row?.variants_without_cost ?? 0),
      productsWithoutCost: Number(row?.products_without_cost ?? 0),
      variantsWithCost: Number(row?.variants_with_cost ?? 0),
    };
  }

  /** The variant exists and is not stale: the only variants an operator can act on. */
  private liveVariantCondition(): string {
    return 'pv."id" IS NOT NULL AND pv."isStale" = false';
  }

  /**
   * Shared FROM/WHERE of the work list rows and its count: `product_variants`
   * (base, read by table name - ADR-036) joined to `products` for the name
   * search, and to a per-variant sales aggregate over the net-revenue
   * population of the window. All user input is bound as a parameter.
   */
  private buildCostWorklistQuery(
    filters: CostWorklistCountFilters,
    salesWindow: SalesAnalyticsFilters,
    reportingCurrency: string,
    includeBackfilledPreRollout: boolean
  ): SelectQueryBuilder<ObjectLiteral> {
    const { inRevenue, netAmount } = this.buildMarginSqlFragments(includeBackfilledPreRollout);
    const sales = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .select('li."variantId"', 'variant_id')
      .addSelect(`COALESCE(SUM(${netAmount}) FILTER (WHERE ${inRevenue}), 0)`, 'net_sales')
      .addSelect(`COALESCE(SUM(li."quantity") FILTER (WHERE ${inRevenue}), 0)`, 'units')
      .addSelect(
        `ARRAY_AGG(DISTINCT li."sourceConnectionId"::text) FILTER (WHERE ${inRevenue})`,
        'connection_ids'
      )
      .where('li."variantId" IS NOT NULL')
      .groupBy('li."variantId"')
      .setParameter('reportingCurrency', reportingCurrency);
    this.applyTopProductsScope(sales, {
      from: salesWindow.from,
      to: salesWindow.to,
      sourceConnectionId: filters.channel,
    });

    const qb = this.repository.manager
      .createQueryBuilder()
      .from('product_variants', 'pv')
      .innerJoin('products', 'p', 'p."id" = pv."productId"')
      .leftJoin(`(${sales.getQuery()})`, 's', 's."variant_id" = pv."id"')
      .setParameters(sales.getParameters())
      .where('pv."isStale" = false');

    if (filters.tab === 'has-cost') {
      qb.andWhere('pv."netUnitCost" IS NOT NULL');
    } else {
      qb.andWhere('pv."netUnitCost" IS NULL');
      if (filters.tab === 'sold') {
        qb.andWhere('COALESCE(s."net_sales", 0) > 0');
      }
    }
    if (filters.channel) {
      qb.andWhere('s."variant_id" IS NOT NULL');
    }
    const q = filters.q?.trim();
    if (q) {
      qb.andWhere('(p."name" ILIKE :worklistQ OR pv."sku" ILIKE :worklistQ)', {
        worklistQ: `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`,
      });
    }
    return qb;
  }

  /**
   * Shared SELECT list of every margin read: the additive sums only, grouped by
   * the caller. See the port for the population rules.
   */
  private createMarginQuery(
    reportingCurrency: string,
    includeBackfilledPreRollout: boolean
  ): SelectQueryBuilder<OrderLineItemOrmEntity> {
    const { inRevenue, netAmount, covered, costOfGoods, gapConditions } =
      this.buildMarginSqlFragments(includeBackfilledPreRollout);

    const coveredNet = `COALESCE(SUM(${netAmount}) FILTER (WHERE ${covered}), 0)`;
    const cogs = `COALESCE(SUM(${costOfGoods}) FILTER (WHERE ${covered}), 0)`;

    const qb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .leftJoin('product_variants', 'pv', 'pv."id" = li."variantId"')
      .select(`COALESCE(SUM(${netAmount}) FILTER (WHERE ${inRevenue}), 0)`, 'net_revenue')
      .addSelect(coveredNet, 'covered_net_revenue')
      .addSelect(cogs, 'cost_of_goods')
      .addSelect(`${coveredNet} - ${cogs}`, 'gross_margin')
      .addSelect(`(${coveredNet} - ${cogs}) / NULLIF(${coveredNet}, 0)`, 'margin_pct')
      .addSelect(`COUNT(*) FILTER (WHERE NOT COALESCE((${inRevenue}), false))`, 'excluded_line_count')
      .setParameter('reportingCurrency', reportingCurrency);

    for (const reason of MarginGapReasonValues) {
      const alias = reason.replace(/-/g, '_');
      qb.addSelect(`COUNT(*) FILTER (WHERE ${gapConditions[reason]})`, `gap_${alias}_lines`).addSelect(
        `COALESCE(SUM(${netAmount}) FILTER (WHERE ${gapConditions[reason]}), 0)`,
        `gap_${alias}_net`
      );
    }
    return qb;
  }

  private toMarginSums(row: MarginRawRow): MarginSums {
    return {
      netRevenue: Number(row.net_revenue),
      coveredNetRevenue: Number(row.covered_net_revenue),
      costOfGoods: Number(row.cost_of_goods),
      excludedLineCount: Number(row.excluded_line_count),
      gaps: MarginGapReasonValues.map((reason) => {
        const alias = reason.replace(/-/g, '_');
        return {
          reason,
          lineCount: Number(row[`gap_${alias}_lines`] ?? 0),
          netAmount: Number(row[`gap_${alias}_net`] ?? 0),
        };
      }),
    };
  }

  /**
   * SQL fragments of the margin reads. Every gap condition is a positive
   * conjunction with `inRevenue`, and together they partition
   * `inRevenue AND NOT covered`:
   *  - covered: recorded cost whose currency equals the order's native currency
   *    (G11-C: a different currency puts the line out of margin);
   *  - no-variant: no variant on the line, not covered;
   *  - currency-mismatch: has a variant, recorded cost, wrong currency;
   *  - cost-entered-after-sale: has a variant, no snapshot, the variant has a cost now;
   *  - no-cost: has a variant, no snapshot, the variant has none (or is gone).
   * `fx` is the order's own implicit multiplier `reportingTotalAmount /
   * totalAmount`, applied to revenue AND cost so both are in the reporting currency.
   */
  private buildMarginSqlFragments(includeBackfilledPreRollout: boolean): {
    inRevenue: string;
    netAmount: string;
    covered: string;
    costOfGoods: string;
    gapConditions: Record<MarginGapReason, string>;
  } {
    const { lineNetAmount, stampedNonZeroKnownRate } = this.buildTopProductsSqlFragments(
      includeBackfilledPreRollout
    );
    const fx = '(rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))';
    const inRevenue = `(${stampedNonZeroKnownRate})`;
    const currencyMatches = `COALESCE(li."unitCostCurrency" = rec."currency", false)`;
    const recorded = `li."costState" = 'recorded'`;
    const covered = `${inRevenue} AND ${recorded} AND ${currencyMatches}`;
    return {
      inRevenue,
      netAmount: `(${lineNetAmount}) * ${fx}`,
      covered,
      costOfGoods: `li."unitCostNet" * li."quantity" * ${fx}`,
      gapConditions: {
        'no-variant': `${inRevenue} AND li."variantId" IS NULL AND NOT (${recorded} AND ${currencyMatches})`,
        'currency-mismatch': `${inRevenue} AND li."variantId" IS NOT NULL AND ${recorded} AND NOT ${currencyMatches}`,
        'cost-entered-after-sale': `${inRevenue} AND li."variantId" IS NOT NULL AND NOT (${recorded}) AND pv."netUnitCost" IS NOT NULL`,
        'no-cost': `${inRevenue} AND li."variantId" IS NOT NULL AND NOT (${recorded}) AND pv."netUnitCost" IS NULL`,
      },
    };
  }

  private toDomain(entity: OrderLineItemOrmEntity): OrderLineItem {
    return new OrderLineItem(
      entity.id,
      entity.orderRecordId,
      entity.lineNumber,
      entity.productId,
      entity.variantId,
      entity.quantity,
      // decimal column arrives as a string from the pg driver — mirrors
      // ProductRepository's existing `Number(entity.price)` handling.
      Number(entity.unitPrice),
      entity.sourceConnectionId,
      entity.placedAt,
      entity.createdAt,
      entity.taxRate,
      entity.taxSource,
      entity.taxRateReadAt,
      entity.unitCostNet,
      entity.unitCostCurrency,
      entity.costState
    );
  }

  async findPageWithNoTaxRate(input: {
    sourceConnectionId: string;
    limit: number;
    afterId: string | null;
  }): Promise<OrderLineItem[]> {
    const qb = this.repository
      .createQueryBuilder('li')
      .where('li."taxRate" IS NULL')
      .andWhere('li."sourceConnectionId" = :sourceConnectionId', {
        sourceConnectionId: input.sourceConnectionId,
      })
      .orderBy('li."id"', 'ASC')
      .take(input.limit);
    if (input.afterId) {
      qb.andWhere('li."id" > :afterId', { afterId: input.afterId });
    }
    const entities = await qb.getMany();
    return entities.map((e) => this.toDomain(e));
  }

  /**
   * Every distinct (productId, variantId) pair per order, batched (#2799,
   * corrected per #2799 review BLOCKING 1) — see the port's JSDoc. Grouping
   * by all three columns (rather than the prior `DISTINCT ON
   * orderRecordId`) is deliberate: `DISTINCT ON` collapses an order to its
   * single lowest-`lineNumber` line, which silently dropped every other
   * product a multi-product order touched. No aggregate function is
   * selected, so `GROUP BY` here is a plain dedup, not an aggregation.
   */
  async findProductRefsByOrderIds(
    orderRecordIds: string[]
  ): Promise<Map<string, Array<{ productId: string; variantId: string | null }>>> {
    if (orderRecordIds.length === 0) {
      return new Map();
    }

    const rows = await this.repository
      .createQueryBuilder('li')
      .select('li."orderRecordId"', 'order_record_id')
      .addSelect('li."productId"', 'product_id')
      .addSelect('li."variantId"', 'variant_id')
      .where('li."orderRecordId" IN (:...orderRecordIds)', { orderRecordIds })
      .groupBy('li."orderRecordId"')
      .addGroupBy('li."productId"')
      .addGroupBy('li."variantId"')
      .orderBy('li."orderRecordId"', 'ASC')
      .addOrderBy('li."productId"', 'ASC')
      .getRawMany<{ order_record_id: string; product_id: string; variant_id: string | null }>();

    const map = new Map<string, Array<{ productId: string; variantId: string | null }>>();
    for (const row of rows) {
      const existing = map.get(row.order_record_id);
      const ref = { productId: row.product_id, variantId: row.variant_id };
      if (existing) {
        existing.push(ref);
      } else {
        map.set(row.order_record_id, [ref]);
      }
    }
    return map;
  }

  async backfillTaxRate(
    id: string,
    patch: { taxRate: string; taxSource: 'backfill'; taxRateReadAt: Date }
  ): Promise<void> {
    await this.repository.query(
      `UPDATE "order_line_items"
       SET "taxRate" = $1, "taxSource" = $2, "taxRateReadAt" = $3
       WHERE "id" = $4 AND "taxRate" IS NULL`,
      [patch.taxRate, patch.taxSource, patch.taxRateReadAt, id]
    );
  }
}
