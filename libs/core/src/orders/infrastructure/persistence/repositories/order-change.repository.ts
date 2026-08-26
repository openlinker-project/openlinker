/**
 * Order Change Repository (#2333, ADR-044)
 *
 * TypeORM implementation of `OrderChangeRepositoryPort`.
 *
 * Every mutator is a narrow conditional UPDATE reporting `affected > 0` — the
 * `ShipmentRepository.claimWaybillRelay` shape, and the house discipline for a
 * single-writer column. `insertRequested` is insert-then-recover: a unique
 * violation on `UQ_order_changes_open_target` means a peer already holds the
 * slot, so the winner is re-selected rather than the caller being failed.
 *
 * ## Why `ON CONFLICT DO NOTHING` is spelled as catch-23505
 *
 * TypeORM's `orIgnore()` builds `ON CONFLICT DO NOTHING` without a conflict
 * TARGET, which is fine here (there is one unique index on the table) but tells
 * the reader nothing about which constraint it is relying on. Catching the
 * driver's `23505` and re-selecting by the same predicate as the index makes
 * that dependency explicit and matches
 * `IdentifierMappingRepository.insertMapping`. The code is matched, never the
 * message — a locale-dependent string is not a contract.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories
 * @implements {OrderChangeRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, QueryFailedError, Repository } from 'typeorm';
import { OrderChange } from '../../../domain/entities/order-change.entity';
import { OrderChangeVocabularyError } from '../../../domain/exceptions/order-change-vocabulary.error';
import type {
  InsertOrderChangeResult,
  OrderChangeRepositoryPort,
} from '../../../domain/ports/order-change-repository.port';
import {
  isOrderChangeKind,
  isOrderChangeStatus,
  OPEN_ORDER_CHANGE_STATUSES,
  type CreateOrderChangeInput,
  type OrderChangeKind,
  type OrderChangeStatus,
} from '../../../domain/types/order-change.types';
import { OrderChangeOrmEntity } from '../entities/order-change.orm-entity';

/** PostgreSQL `unique_violation`. Matched by code, never by message. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class OrderChangeRepository implements OrderChangeRepositoryPort {
  constructor(
    @InjectRepository(OrderChangeOrmEntity)
    private readonly repository: Repository<OrderChangeOrmEntity>
  ) {}

  async findOpenByTarget(
    internalOrderId: string,
    targetRef: string
  ): Promise<OrderChange | null> {
    const entity = await this.repository.findOne({
      where: {
        internalOrderId,
        targetRef,
        status: In([...OPEN_ORDER_CHANGE_STATUSES]),
      },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findLatestByTarget(
    internalOrderId: string,
    targetRef: string,
    kind: OrderChangeKind
  ): Promise<OrderChange | null> {
    const entity = await this.repository.findOne({
      where: { internalOrderId, targetRef, kind },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async insertRequested(
    input: CreateOrderChangeInput
  ): Promise<InsertOrderChangeResult> {
    const entity = new OrderChangeOrmEntity();
    entity.internalOrderId = input.internalOrderId;
    entity.kind = input.kind;
    entity.targetRef = input.targetRef;
    entity.status = 'requested';
    entity.payload = input.payload;
    entity.requestedBy = input.requestedBy;
    entity.requestedAt = input.requestedAt;
    entity.confirmedBy = null;
    entity.terminalisedAt = null;
    entity.declinedReason = null;
    entity.appliedAt = null;

    try {
      return { change: this.toDomain(await this.repository.save(entity)), inserted: true };
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }

      // A peer holds the slot. Re-select by the index's own predicate and
      // return the winner, so a concurrent double-click produces one row and
      // one downstream remote call rather than a failed request.
      const winner = await this.findOpenByTarget(
        input.internalOrderId,
        input.targetRef
      );
      if (winner === null) {
        // The peer's row terminalised between the conflict and this read, so
        // the slot is free again. Rethrowing is honest: the caller retries and
        // gets a clean insert, which is strictly better than looping here.
        throw error;
      }
      return { change: winner, inserted: false };
    }
  }

  async confirm(
    id: string,
    at: Date,
    confirmedBy: string | null
  ): Promise<boolean> {
    const result = await this.repository.update(
      { id, status: 'requested' },
      { status: 'confirmed', terminalisedAt: at, confirmedBy }
    );
    return (result.affected ?? 0) > 0;
  }

  async decline(id: string, at: Date, reason: string): Promise<boolean> {
    const result = await this.repository.update(
      { id, status: 'requested' },
      { status: 'declined', terminalisedAt: at, declinedReason: reason }
    );
    return (result.affected ?? 0) > 0;
  }

  async expire(id: string, at: Date): Promise<boolean> {
    const result = await this.repository.update(
      { id, status: In([...OPEN_ORDER_CHANGE_STATUSES]) },
      { status: 'expired', terminalisedAt: at }
    );
    return (result.affected ?? 0) > 0;
  }

  async claimApplied(id: string, at: Date): Promise<boolean> {
    const result = await this.repository.update(
      { id, appliedAt: IsNull() },
      { appliedAt: at }
    );
    return (result.affected ?? 0) > 0;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof QueryFailedError &&
      (error as QueryFailedError & { code?: string }).code ===
        PG_UNIQUE_VIOLATION
    );
  }

  /**
   * Coerce the two stored vocabularies on read.
   *
   * A value this build does not recognise is a real possibility once Wave 2
   * widens `kind` and a rollback follows, so it is reported rather than
   * silently mapped onto a neighbour — the `isOrderAmendmentKind` posture.
   */
  private toDomain(entity: OrderChangeOrmEntity): OrderChange {
    if (!isOrderChangeKind(entity.kind)) {
      throw new OrderChangeVocabularyError(entity.id, 'kind', entity.kind);
    }
    if (!isOrderChangeStatus(entity.status)) {
      throw new OrderChangeVocabularyError(entity.id, 'status', entity.status);
    }

    const kind: OrderChangeKind = entity.kind;
    const status: OrderChangeStatus = entity.status;

    return new OrderChange(
      entity.id,
      entity.internalOrderId,
      kind,
      entity.targetRef,
      status,
      entity.payload,
      entity.requestedBy,
      entity.requestedAt,
      entity.confirmedBy,
      entity.terminalisedAt,
      entity.declinedReason,
      entity.appliedAt,
      entity.createdAt,
      entity.updatedAt
    );
  }
}
