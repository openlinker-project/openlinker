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
import type { OrderLineItemRepositoryPort } from '../../../domain/ports/order-line-item-repository.port';
import { OrderLineItem } from '../../../domain/entities/order-line-item.entity';

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
      entity.taxRateReadAt
    );
  }
}
