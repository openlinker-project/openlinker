/**
 * Order Hold Repository (#2338, REVIEW §3 H9)
 *
 * TypeORM implementation of `OrderHoldRepositoryPort`.
 *
 * Both mutators are single conditional statements whose outcome the database
 * decides, so no lock is taken and none is needed — two concurrent placers yield
 * one row and one loser, two concurrent releasers one stamp and one loser.
 *
 * ## Why `ON CONFLICT DO NOTHING` is spelled as catch-23505
 *
 * TypeORM's `orIgnore()` builds `ON CONFLICT DO NOTHING` without a conflict
 * TARGET, which tells the reader nothing about which constraint it relies on.
 * Catching the driver's `23505` and re-selecting by the same predicate as the
 * index makes that dependency explicit and matches
 * `IdentifierMappingRepository.insertMapping` and `OrderChangeRepository`. The
 * code is matched, never the message — a locale-dependent string is not a
 * contract.
 *
 * ## No TypeORM error escapes (port rule R4)
 *
 * `23505` becomes `OrderAlreadyOnHoldError`; a zero-affected release becomes
 * `HoldAlreadyReleasedError` or `OrderHoldNotFoundError`; an unrecognised stored
 * `reason` becomes `OrderHoldVocabularyError`. A `QueryFailedError` carrying any
 * OTHER code still propagates untranslated, deliberately: a repository that
 * swallowed every database error would be worse than one that leaked.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 * @implements {OrderHoldRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isHoldReason, type HoldReason } from '@openlinker/core/order-lifecycle';
import { In, IsNull, LessThan, QueryFailedError, Repository } from 'typeorm';
import { OrderHold } from '../../../domain/entities/order-hold.entity';
import { HoldAlreadyReleasedError } from '../../../domain/exceptions/hold-already-released.error';
import { OrderAlreadyOnHoldError } from '../../../domain/exceptions/order-already-on-hold.error';
import { OrderHoldNotFoundError } from '../../../domain/exceptions/order-hold-not-found.error';
import { OrderHoldVocabularyError } from '../../../domain/exceptions/order-hold-vocabulary.error';
import type { OrderHoldRepositoryPort } from '../../../domain/ports/order-hold-repository.port';
import type {
  PlaceOrderHoldInput,
  ReleaseOrderHoldInput,
} from '../../../domain/types/order-hold.types';
import { OrderHoldOrmEntity } from '../entities/order-hold.orm-entity';

/** PostgreSQL `unique_violation`. Matched by code, never by message. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class OrderHoldRepository implements OrderHoldRepositoryPort {
  constructor(
    @InjectRepository(OrderHoldOrmEntity)
    private readonly repository: Repository<OrderHoldOrmEntity>
  ) {}

  async placeIfNoneOpen(input: PlaceOrderHoldInput): Promise<OrderHold> {
    const entity = new OrderHoldOrmEntity();
    entity.internalOrderId = input.internalOrderId;
    entity.reason = input.reason;
    entity.note = input.note;
    entity.placedByUserId =
      input.placedBy.kind === 'user' ? input.placedBy.userId : null;
    entity.placedByService =
      input.placedBy.kind === 'service' ? input.placedBy.service : null;
    entity.placedAt = input.placedAt;
    entity.releasedAt = null;
    entity.releasedByUserId = null;
    entity.releaseNote = null;

    try {
      return this.toDomain(await this.repository.save(entity));
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }

      // A peer holds the slot. Re-select by the index's own predicate so the
      // error can name the hold that won, which is what #2341 renders in its
      // 409 and what an operator needs in order to act.
      const winner = await this.findOpenByOrder(input.internalOrderId);
      if (winner === null) {
        // The peer's hold was released between the conflict and this read, so
        // the slot is free again. Rethrowing is honest: the caller retries and
        // gets a clean insert, which beats looping here — and reporting
        // "already on hold" would be a false statement about a now-unheld order.
        throw error;
      }
      throw new OrderAlreadyOnHoldError(input.internalOrderId, winner.id);
    }
  }

  async releaseHeld(input: ReleaseOrderHoldInput): Promise<OrderHold> {
    // One statement: the conditional UPDATE and the row it stamped. `affected`
    // and the returned row cannot disagree, and there is no read-after-write.
    const result = await this.repository
      .createQueryBuilder()
      .update(OrderHoldOrmEntity)
      .set({
        releasedAt: input.releasedAt,
        releasedByUserId: input.releasedByUserId,
        releaseNote: input.releaseNote,
      })
      .where('"id" = :id AND "releasedAt" IS NULL', { id: input.holdId })
      .returning('*')
      .execute();

    const rows = result.raw as OrderHoldOrmEntity[];
    if (rows.length > 0) {
      return this.toDomain(rows[0]);
    }

    // Zero rows has TWO causes, and they are different facts. Re-read to say
    // which — claiming a hold that never existed was "already released" would be
    // a false statement about the operator's data.
    const existing = await this.repository.findOne({
      where: { id: input.holdId },
    });
    if (existing === null) {
      throw new OrderHoldNotFoundError(input.holdId);
    }
    // `releasedAt` is non-null here: the row exists and the UPDATE's only other
    // predicate was `IS NULL`. Coalesced rather than asserted so a future
    // widening of that WHERE clause degrades to a wrong timestamp, not a crash.
    throw new HoldAlreadyReleasedError(
      input.holdId,
      existing.releasedAt ?? input.releasedAt
    );
  }

  async findById(id: string): Promise<OrderHold | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findOpenByOrder(internalOrderId: string): Promise<OrderHold | null> {
    const entity = await this.repository.findOne({
      where: { internalOrderId, releasedAt: IsNull() },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findOpenByOrders(internalOrderIds: string[]): Promise<OrderHold[]> {
    // An empty `In([])` builds `IN ()`, which is a syntax error on some drivers
    // and a full scan on others. Answer without a query instead.
    if (internalOrderIds.length === 0) {
      return [];
    }

    const entities = await this.repository.find({
      where: { internalOrderId: In(internalOrderIds), releasedAt: IsNull() },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async listByOrder(internalOrderId: string): Promise<OrderHold[]> {
    const entities = await this.repository.find({
      where: { internalOrderId },
      // `id` breaks the tie: `placedAt` is caller-supplied and two holds on one
      // order can legitimately carry the same instant in a test or a backfill.
      order: { placedAt: 'DESC', id: 'DESC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async listOpenPlacedBefore(
    before: Date,
    limit: number
  ): Promise<OrderHold[]> {
    const entities = await this.repository.find({
      where: { releasedAt: IsNull(), placedAt: LessThan(before) },
      order: { placedAt: 'ASC', id: 'ASC' },
      take: limit,
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async listOpenHolds(limit: number, offset: number): Promise<OrderHold[]> {
    const entities = await this.repository.find({
      where: { releasedAt: IsNull() },
      // Ordered by `id`, not `placedAt`: see the port's docblock for why, and
      // for what offset paging still cannot promise over a shrinking set.
      order: { id: 'ASC' },
      skip: offset,
      take: limit,
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { code?: string }).code ===
        PG_UNIQUE_VIOLATION
    );
  }

  /**
   * Coerce the stored reason on read.
   *
   * Reported rather than defaulted: silently mapping an unrecognised value onto
   * `operator` would attribute a machine's hold to a human, which is exactly
   * what `isHoldReason`'s no-fallback posture exists to prevent.
   */
  private toDomain(entity: OrderHoldOrmEntity): OrderHold {
    if (!isHoldReason(entity.reason)) {
      throw new OrderHoldVocabularyError(entity.id, entity.reason);
    }
    const reason: HoldReason = entity.reason;

    return new OrderHold(
      entity.id,
      entity.internalOrderId,
      reason,
      entity.note,
      entity.placedByUserId,
      entity.placedByService,
      entity.placedAt,
      entity.releasedAt,
      entity.releasedByUserId,
      entity.releaseNote,
      entity.createdAt,
      entity.updatedAt
    );
  }
}
