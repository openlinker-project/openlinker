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
import type { SelectQueryBuilder } from 'typeorm';
import { Repository } from 'typeorm';
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
} from '../../../domain/types/top-products.types';

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
    reportingCurrency: string
  ): Promise<{ rows: ProductRankingRow[]; total: number }> {
    const stampedNonZero = 'rec."reportingCurrency" = :reportingCurrency AND rec."totalAmount" <> 0';
    const unconvertedOrZeroTotal =
      'rec."reportingCurrency" IS DISTINCT FROM :reportingCurrency OR rec."totalAmount" = 0';

    const rankingQb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .select('li.productId', 'product_id')
      .addSelect('COALESCE(SUM(li."quantity"), 0)', 'units')
      .addSelect(
        `COALESCE(SUM(li."unitPrice" * li."quantity" * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZero}), 0)`,
        'revenue'
      )
      .addSelect(
        `COALESCE(SUM(li."unitPrice" * li."quantity") FILTER (WHERE ${unconvertedOrZeroTotal}), 0)`,
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
    reportingCurrency: string
  ): Promise<ProductChannelBreakdownRow[]> {
    if (productIds.length === 0) {
      return [];
    }

    const stampedNonZero = 'rec."reportingCurrency" = :reportingCurrency AND rec."totalAmount" <> 0';
    const unconvertedOrZeroTotal =
      'rec."reportingCurrency" IS DISTINCT FROM :reportingCurrency OR rec."totalAmount" = 0';

    const qb = this.repository
      .createQueryBuilder('li')
      .innerJoin(OrderRecordOrmEntity, 'rec', 'rec."internalOrderId" = li."orderRecordId"')
      .select('li.productId', 'product_id')
      .addSelect('li.sourceConnectionId', 'source_connection_id')
      .addSelect('COALESCE(SUM(li."quantity"), 0)', 'units')
      .addSelect(
        `COALESCE(SUM(li."unitPrice" * li."quantity" * (rec."reportingTotalAmount" / NULLIF(rec."totalAmount", 0))) FILTER (WHERE ${stampedNonZero}), 0)`,
        'revenue'
      )
      .addSelect(
        `COALESCE(SUM(li."unitPrice" * li."quantity") FILTER (WHERE ${unconvertedOrZeroTotal}), 0)`,
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
    }>();

    return rows.map((row) => ({
      productId: row.product_id,
      sourceConnectionId: row.source_connection_id,
      units: Number(row.units),
      revenue: Number(row.revenue),
      unconvertedRevenue: Number(row.unconverted_revenue),
      currency: row.reporting_currency,
      unconvertedCurrency: row.unconverted_currency,
    }));
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
      entity.createdAt
    );
  }
}
