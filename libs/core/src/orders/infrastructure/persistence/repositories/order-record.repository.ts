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
import type { SelectQueryBuilder } from 'typeorm';
import { Repository } from 'typeorm';
import type { OrderSyncStatusJson, SyncAttemptJson } from '../entities/order-record.orm-entity';
import { OrderRecordOrmEntity } from '../entities/order-record.orm-entity';
import type { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import { OrderRecord } from '../../../domain/entities/order-record.entity';
import type { OrderSyncStatus, SyncAttempt } from '../../../domain/types/order-sync.types';
import { SYNC_ATTEMPTS_PER_DESTINATION_CAP } from '../../../domain/types/order-sync.types';
import { OrderRecordNotFoundException } from '../../../domain/exceptions/order-record-not-found.exception';
import type {
  OrderRecordFilters,
  OrderRecordPagination,
  PaginatedOrderRecords,
  OrderRecordStatus,
} from '../../../domain/types/order-record.types';

@Injectable()
export class OrderRecordRepository implements OrderRecordRepositoryPort {
  constructor(
    @InjectRepository(OrderRecordOrmEntity)
    private readonly repository: Repository<OrderRecordOrmEntity>
  ) {}

  async findById(internalOrderId: string): Promise<OrderRecord | null> {
    const entity = await this.repository.findOne({
      where: { internalOrderId },
    });

    if (!entity) {
      return null;
    }

    return this.toDomain(entity);
  }

  async findMany(
    filters: OrderRecordFilters,
    pagination: OrderRecordPagination
  ): Promise<PaginatedOrderRecords> {
    const qb: SelectQueryBuilder<OrderRecordOrmEntity> = this.repository
      .createQueryBuilder('rec')
      .orderBy('rec.createdAt', 'DESC')
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

    const [entities, total] = await qb.getManyAndCount();

    return {
      items: entities.map((e) => this.toDomain(e)),
      total,
    };
  }

  async upsert(orderRecord: OrderRecord): Promise<OrderRecord> {
    const entity = this.toOrm(orderRecord);
    // TypeORM save() performs upsert on primary key (internalOrderId)
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
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
    const syncStatus: OrderSyncStatus[] = entity.syncStatus.map((s) => ({
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
      syncAttempts
    );
  }

  /**
   * Convert domain entity to ORM entity
   */
  private toOrm(orderRecord: OrderRecord): OrderRecordOrmEntity {
    const entity = new OrderRecordOrmEntity();
    entity.internalOrderId = orderRecord.internalOrderId;
    entity.customerId = orderRecord.customerId;
    entity.sourceConnectionId = orderRecord.sourceConnectionId;
    entity.sourceEventId = orderRecord.sourceEventId;
    entity.orderSnapshot = orderRecord.orderSnapshot;
    entity.syncStatus = orderRecord.syncStatus.map((s) => ({
      destinationConnectionId: s.destinationConnectionId,
      status: s.status,
      syncedAt: s.syncedAt?.toISOString(),
      externalOrderId: s.externalOrderId,
      externalOrderNumber: s.externalOrderNumber,
      error: s.error,
    }));
    entity.syncAttempts = orderRecord.syncAttempts.map((a) => ({
      destinationConnectionId: a.destinationConnectionId,
      status: a.status,
      attemptedAt: a.attemptedAt.toISOString(),
      error: a.error,
      externalOrderId: a.externalOrderId,
      externalOrderNumber: a.externalOrderNumber,
    }));
    entity.recordStatus = orderRecord.recordStatus;
    entity.createdAt = orderRecord.createdAt;
    entity.updatedAt = orderRecord.updatedAt;
    return entity;
  }
}
