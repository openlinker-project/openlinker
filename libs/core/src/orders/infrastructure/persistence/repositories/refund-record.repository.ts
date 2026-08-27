/**
 * Refund Record Repository
 *
 * TypeORM implementation of `RefundRecordRepositoryPort`. Maps ORM ↔ domain
 * privately; callers receive domain entities only (#2036). Converts the
 * Postgres unique-violation on the idempotency dedup index into
 * `DuplicateRefundRecordException` (never leaks `QueryFailedError`), mirroring
 * `InvoiceRecordRepository.create`.
 *
 * @module infrastructure/persistence/repositories
 * @implements {RefundRecordRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Logger } from '@openlinker/shared/logging';
import { QueryFailedError, Repository } from 'typeorm';

import { RefundRecord } from '../../../domain/entities/refund-record.entity';
import { DuplicateRefundRecordException } from '../../../domain/exceptions/duplicate-refund-record.exception';
import type { RefundRecordRepositoryPort } from '../../../domain/ports/refund-record-repository.port';
import {
  RefundExecutedByValues,
  RefundReasonValues,
  type CreateRefundRecordInput,
  type RefundExecutedBy,
  type RefundReason,
  type RefundSummary,
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
  private readonly logger = new Logger(RefundRecordRepository.name);

  constructor(
    @InjectRepository(RefundRecordOrmEntity)
    private readonly repository: Repository<RefundRecordOrmEntity>,
  ) {}

  async create(input: CreateRefundRecordInput): Promise<RefundRecord> {
    const entity = this.buildOrmEntity(input);
    try {
      const saved = await this.repository.save(entity);
      return this.toDomain(saved);
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        error.message.includes('duplicate key') &&
        input.idempotencyKey
      ) {
        throw new DuplicateRefundRecordException(input.internalOrderId, input.idempotencyKey);
      }
      throw error;
    }
  }

  async findByOrderId(internalOrderId: string): Promise<RefundRecord[]> {
    const entities = await this.repository.find({
      where: { internalOrderId },
      order: { recordedAt: 'DESC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findByReturnId(returnId: string): Promise<RefundRecord[]> {
    const entities = await this.repository.find({
      where: { returnId },
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
    // `amount` is `numeric(12,2)` at the DB layer (no CAST needed) and
    // `OrderRefundService.recordRefund` rejects a currency mismatch against
    // an order's prior refunds, so MIN(currency) is safe rather than an
    // unenforced assumption.
    const rawRows = await this.repository
      .createQueryBuilder('record')
      .select('record.internalOrderId', 'internalOrderId')
      .addSelect('COUNT(*)', 'count')
      .addSelect('SUM(record.amount)', 'totalAmount')
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
    entity.idempotencyKey = input.idempotencyKey ?? null;
    entity.returnId = input.returnId ?? null;
    entity.executedBy = input.executedBy ?? 'operator_out_of_band';
    return entity;
  }

  /**
   * Typed, fail-safe read of the stored `reason` column (#2036). Mirrors
   * `OrderRecord.paymentStatus`'s narrow-or-fallback pattern rather than a
   * blind `as RefundReason` cast — a row written before a future reason was
   * removed from `RefundReasonValues`, or inserted by a caller that bypassed
   * the DTO validator, should degrade to `'other'` with a warning, not hand
   * out a value outside the union.
   */
  private toRefundReason(rawReason: string): RefundReason {
    if ((RefundReasonValues as readonly string[]).includes(rawReason)) {
      return rawReason as RefundReason;
    }
    this.logger.warn(`Unrecognised refund reason "${rawReason}" — falling back to "other"`);
    return 'other';
  }

  private toDomain(entity: RefundRecordOrmEntity): RefundRecord {
    return new RefundRecord(
      entity.id,
      entity.internalOrderId,
      entity.amount,
      entity.currency,
      this.toRefundReason(entity.reason),
      entity.note,
      entity.recordedAt,
      entity.createdAt,
      entity.updatedAt,
      entity.idempotencyKey,
      entity.returnId,
      this.toExecutedBy(entity.executedBy),
    );
  }

  /**
   * Narrow-or-fallback read of `executedBy`, mirroring {@link toRefundReason}.
   *
   * Falls back to `operator_out_of_band` rather than throwing, because that is
   * the value every historical row carries and the only one OL can honestly
   * assert about a refund it did not execute. A blind cast would hand a caller
   * a value outside the union; #2382 renders this field, so a stray string
   * would reach an operator as a claim about who moved their money.
   */
  private toExecutedBy(raw: string): RefundExecutedBy {
    if ((RefundExecutedByValues as readonly string[]).includes(raw)) {
      return raw as RefundExecutedBy;
    }
    this.logger.warn(
      `Unrecognised refund executedBy "${raw}" — falling back to "operator_out_of_band"`
    );
    return 'operator_out_of_band';
  }
}
