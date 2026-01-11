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
import { Repository } from 'typeorm';
import { OrderRecordOrmEntity, OrderSyncStatusJson } from '../entities/order-record.orm-entity';
import { OrderRecordRepositoryPort } from '../../../domain/ports/order-record-repository.port';
import { OrderRecord, OrderSyncStatus } from '../../../domain/entities/order-record.entity';
import { OrderRecordNotFoundException } from '../../../domain/exceptions/order-record-not-found.exception';

@Injectable()
export class OrderRecordRepository implements OrderRecordRepositoryPort {
  constructor(
    @InjectRepository(OrderRecordOrmEntity)
    private readonly repository: Repository<OrderRecordOrmEntity>,
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

  async upsert(orderRecord: OrderRecord): Promise<OrderRecord> {
    const entity = this.toOrm(orderRecord);
    // TypeORM save() performs upsert on primary key (internalOrderId)
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async updateSyncStatus(
    internalOrderId: string,
    destinationConnectionId: string,
    status: OrderSyncStatus,
  ): Promise<void> {
    const entity = await this.repository.findOne({
      where: { internalOrderId },
    });

    if (!entity) {
      throw new OrderRecordNotFoundException(internalOrderId);
    }

    // Update or add sync status for the destination
    const existingIndex = entity.syncStatus.findIndex(
      (s) => s.destinationConnectionId === destinationConnectionId,
    );

    const statusJson: OrderSyncStatusJson = {
      destinationConnectionId: status.destinationConnectionId,
      status: status.status,
      syncedAt: status.syncedAt?.toISOString(),
      externalOrderId: status.externalOrderId,
      externalOrderNumber: status.externalOrderNumber,
      error: status.error,
    };

    if (existingIndex >= 0) {
      entity.syncStatus[existingIndex] = statusJson;
    } else {
      entity.syncStatus.push(statusJson);
    }

    await this.repository.save(entity);
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

    return new OrderRecord(
      entity.internalOrderId,
      entity.customerId,
      entity.sourceConnectionId,
      entity.sourceEventId,
      entity.orderSnapshot,
      syncStatus,
      entity.createdAt,
      entity.updatedAt,
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
    entity.createdAt = orderRecord.createdAt;
    entity.updatedAt = orderRecord.updatedAt;
    return entity;
  }
}
