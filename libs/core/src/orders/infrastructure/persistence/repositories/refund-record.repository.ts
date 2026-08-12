/**
 * Refund Record Repository
 *
 * TypeORM implementation of `RefundRecordRepositoryPort`. Maps ORM ↔ domain
 * privately; callers receive domain entities only (#2036).
 *
 * @module infrastructure/persistence/repositories
 * @implements {RefundRecordRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RefundRecord } from '../../../domain/entities/refund-record.entity';
import type { RefundRecordRepositoryPort } from '../../../domain/ports/refund-record-repository.port';
import type {
  CreateRefundRecordInput,
  RefundReason,
  RefundSummary,
} from '../../../domain/types/refund-record.types';
import { RefundRecordOrmEntity } from '../entities/refund-record.orm-entity';

interface RefundSummaryRawRow {
  internalOrderId: string;
  count: string;
  totalAmount: string;
  currency: string;
}

@Injectable()
export class RefundRecordRepository implements RefundRecordRepositoryPort {
  constructor(
    @InjectRepository(RefundRecordOrmEntity)
    private readonly repository: Repository<RefundRecordOrmEntity>,
  ) {}

  async create(input: CreateRefundRecordInput): Promise<RefundRecord> {
    const entity = this.buildOrmEntity(input);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findByOrderId(internalOrderId: string): Promise<RefundRecord[]> {
    const entities = await this.repository.find({
      where: { internalOrderId },
      order: { recordedAt: 'DESC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async summarizeByOrderIds(internalOrderIds: string[]): Promise<Map<string, RefundSummary>> {
    if (internalOrderIds.length === 0) {
      return new Map();
    }

    // One aggregate query for the whole id set — the real batch a
    // cross-cutting analytics read needs, as opposed to an N-call fan-out.
    // MIN(currency) is a documented simplification (see refund-record.types.ts):
    // it assumes every refund against one order shares a currency, matching
    // OrderTotals.currency being singular per order.
    const rawRows = await this.repository
      .createQueryBuilder('record')
      .select('record.internalOrderId', 'internalOrderId')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(CAST(record.amount AS numeric))', 'totalAmount')
      .addSelect('MIN(record.currency)', 'currency')
      .where('record.internalOrderId IN (:...internalOrderIds)', { internalOrderIds })
      .groupBy('record.internalOrderId')
      .getRawMany<RefundSummaryRawRow>();

    const summaries = new Map<string, RefundSummary>();
    for (const row of rawRows) {
      summaries.set(row.internalOrderId, {
        count: Number(row.count),
        totalAmount: row.totalAmount,
        currency: row.currency,
      });
    }
    return summaries;
  }

  private buildOrmEntity(input: CreateRefundRecordInput): RefundRecordOrmEntity {
    const entity = new RefundRecordOrmEntity();
    entity.internalOrderId = input.internalOrderId;
    entity.amount = input.amount;
    entity.currency = input.currency;
    entity.reason = input.reason;
    entity.note = input.note;
    entity.recordedAt = input.recordedAt;
    return entity;
  }

  private toDomain(entity: RefundRecordOrmEntity): RefundRecord {
    return new RefundRecord(
      entity.id,
      entity.internalOrderId,
      entity.amount,
      entity.currency,
      entity.reason as RefundReason,
      entity.note,
      entity.recordedAt,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}
