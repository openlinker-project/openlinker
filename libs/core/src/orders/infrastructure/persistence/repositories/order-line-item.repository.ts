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
import { Repository } from 'typeorm';
import { OrderLineItemOrmEntity } from '../entities/order-line-item.orm-entity';
import { OrderRecordOrmEntity } from '../entities/order-record.orm-entity';
import type { OrderLineItemRepositoryPort } from '../../../domain/ports/order-line-item-repository.port';
import { OrderLineItem } from '../../../domain/entities/order-line-item.entity';
import type {
  ConnectionUnitsSold,
  SalesAnalyticsFilters,
} from '../../../domain/types/order-sales-analytics.types';

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
