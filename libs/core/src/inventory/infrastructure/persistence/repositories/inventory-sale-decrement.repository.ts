/**
 * Inventory Sale Decrement Repository (#3453)
 *
 * TypeORM implementation of {@link InventorySaleDecrementRepositoryPort}.
 *
 * The two conflict-bearing writes are raw `INSERT … ON CONFLICT` statements
 * because TypeORM 0.3.17's builder cannot put a `WHERE` on the conflict's
 * `DO UPDATE`, and that `WHERE` is the whole guarantee: it is what lets a
 * `retryable` row be re-claimed while every other state stays untouched. The raw
 * `INSERT … RETURNING` reply is the row array itself (the Postgres runner only
 * wraps `UPDATE` / `DELETE` replies), which is why `claim` reads `rows.length`.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/repositories
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { InventorySaleDecrement } from '../../../domain/entities/inventory-sale-decrement.entity';
import type {
  InventorySaleDecrementRepositoryPort,
  SaleDecrementLineRef,
  SaleDecrementSettlement,
  SaleDecrementUnclaimedOutcome,
} from '../../../domain/ports/inventory-sale-decrement-repository.port';
import { InventorySaleDecrementOrmEntity } from '../entities/inventory-sale-decrement.orm-entity';

const TABLE = '"inventory_sale_decrements"';

/** The line columns, in the order both conflict statements bind them. */
const LINE_COLUMNS =
  '"idempotencyKey", "orderId", "workId", "orderLineId", "productId", ' +
  '"productVariantId", "ownerConnectionId", "quantity"';

@Injectable()
export class InventorySaleDecrementRepository implements InventorySaleDecrementRepositoryPort {
  constructor(
    @InjectRepository(InventorySaleDecrementOrmEntity)
    private readonly repository: Repository<InventorySaleDecrementOrmEntity>
  ) {}

  async claim(line: SaleDecrementLineRef): Promise<InventorySaleDecrement | null> {
    const rows = (await this.repository.query(
      `INSERT INTO ${TABLE} (${LINE_COLUMNS}, "status")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
       ON CONFLICT ("idempotencyKey") DO UPDATE
         SET "status" = 'pending', "reason" = NULL, "detail" = NULL, "updatedAt" = now()
         WHERE ${TABLE}."status" = 'retryable'
       RETURNING *`,
      this.lineParams(line)
    )) as InventorySaleDecrementOrmEntity[];

    return rows.length > 0 ? this.toDomain(rows[0]) : null;
  }

  async recordUnclaimed(
    line: SaleDecrementLineRef,
    outcome: SaleDecrementUnclaimedOutcome
  ): Promise<void> {
    await this.repository.query(
      `INSERT INTO ${TABLE} (${LINE_COLUMNS}, "status", "reason", "detail")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT ("idempotencyKey") DO UPDATE
         SET "status" = EXCLUDED."status",
             "reason" = EXCLUDED."reason",
             "detail" = EXCLUDED."detail",
             "updatedAt" = now()
         WHERE ${TABLE}."status" = 'retryable'`,
      [...this.lineParams(line), outcome.status, outcome.reason, outcome.detail]
    );
  }

  async settle(id: string, settlement: SaleDecrementSettlement): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(InventorySaleDecrementOrmEntity)
      .set({
        status: settlement.status,
        reason: settlement.reason,
        detail: settlement.detail,
        clamped: settlement.clamped,
        idempotencyUnsupported: settlement.idempotencyUnsupported,
        resultingQuantity: settlement.resultingQuantity,
      })
      .where('"id" = :id', { id })
      .execute();
  }

  async markInterrupted(idempotencyKey: string): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(InventorySaleDecrementOrmEntity)
      .set({
        status: 'in_doubt',
        reason: 'interrupted',
        detail:
          'a previous attempt stopped after claiming this decrement; ' +
          'OpenLinker cannot tell whether the product master lowered its stock',
      })
      .where('"idempotencyKey" = :idempotencyKey', { idempotencyKey })
      .andWhere(`"status" = 'pending'`)
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async findByKey(idempotencyKey: string): Promise<InventorySaleDecrement | null> {
    const row = await this.repository.findOne({ where: { idempotencyKey } });
    return row === null ? null : this.toDomain(row);
  }

  async findByOrderId(orderId: string): Promise<InventorySaleDecrement[]> {
    const rows = await this.repository.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((row) => this.toDomain(row));
  }

  private lineParams(line: SaleDecrementLineRef): unknown[] {
    return [
      line.idempotencyKey,
      line.orderId,
      line.workId,
      line.orderLineId,
      line.productId,
      line.productVariantId,
      line.ownerConnectionId,
      line.quantity,
    ];
  }

  private toDomain(row: InventorySaleDecrementOrmEntity): InventorySaleDecrement {
    return new InventorySaleDecrement(
      row.id,
      row.idempotencyKey,
      row.orderId,
      row.workId,
      row.orderLineId,
      row.productId,
      row.productVariantId ?? null,
      row.ownerConnectionId ?? null,
      Number(row.quantity),
      row.status,
      row.reason ?? null,
      row.detail ?? null,
      row.clamped === true,
      row.idempotencyUnsupported === true,
      row.resultingQuantity === null || row.resultingQuantity === undefined
        ? null
        : Number(row.resultingQuantity),
      new Date(row.createdAt),
      new Date(row.updatedAt)
    );
  }
}
