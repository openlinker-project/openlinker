/**
 * Shipment Repository
 *
 * TypeORM implementation of `ShipmentRepositoryPort`. Handles all ORM ↔
 * domain mapping privately; callers receive domain `Shipment` entities
 * only. Generates the `ol_shipment_*` internal id via `formatInternalId`
 * at create-time (no `IdentifierMappingService` call — `Shipment` is not
 * cross-platform-mapped).
 *
 * Throws `ShipmentNotFoundException` from `update()` when no row matches.
 *
 * @module libs/core/src/shipping/infrastructure/persistence/repositories
 * @implements {ShipmentRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  type FindOptionsWhere,
  In,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
  Repository,
} from 'typeorm';

import { formatInternalId } from '@openlinker/core/identifier-mapping';

import { Shipment } from '../../../domain/entities/shipment.entity';
import { ShipmentNotFoundException } from '../../../domain/exceptions/shipment-not-found.exception';
import type { ShipmentRepositoryPort } from '../../../domain/ports/shipment-repository.port';
import { TerminalShipmentStatusValues } from '../../../domain/types/shipment-status.types';
import type {
  PaginatedShipments,
  ShipmentFilters,
  ShipmentPagination,
} from '../../../domain/types/shipment-query.types';
import type {
  CreateShipmentInput,
  UpdateShipmentInput,
} from '../../../domain/types/shipment.types';
import { ShipmentOrmEntity } from '../entities/shipment.orm-entity';

@Injectable()
export class ShipmentRepository implements ShipmentRepositoryPort {
  constructor(
    @InjectRepository(ShipmentOrmEntity)
    private readonly repository: Repository<ShipmentOrmEntity>,
  ) {}

  async create(input: CreateShipmentInput): Promise<Shipment> {
    const entity = this.buildOrmEntity(input);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findMany(
    filters: ShipmentFilters,
    pagination: ShipmentPagination,
  ): Promise<PaginatedShipments> {
    const where = this.buildWhere(filters);
    const [entities, total] = await this.repository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: pagination.offset,
      take: pagination.limit,
    });
    return { items: entities.map((entity) => this.toDomain(entity)), total };
  }

  async findById(id: string): Promise<Shipment | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findByOrderId(orderId: string): Promise<readonly Shipment[]> {
    const entities = await this.repository.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async findActiveByOrderId(orderId: string): Promise<Shipment | null> {
    const entity = await this.repository.findOne({
      where: {
        orderId,
        status: Not(In([...TerminalShipmentStatusValues])),
      },
      order: { createdAt: 'DESC' },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findByProviderShipmentId(providerShipmentId: string): Promise<Shipment | null> {
    const entity = await this.repository.findOne({ where: { providerShipmentId } });
    return entity ? this.toDomain(entity) : null;
  }

  async update(id: string, patch: UpdateShipmentInput): Promise<Shipment> {
    const result = await this.repository.update({ id }, this.buildUpdatePayload(patch));
    if (result.affected === 0) {
      throw new ShipmentNotFoundException(id);
    }
    const refreshed = await this.repository.findOne({ where: { id } });
    if (!refreshed) {
      // Defensive — the row was deleted between the update and the read.
      // Treat as not-found so callers see one consistent failure mode.
      throw new ShipmentNotFoundException(id);
    }
    return this.toDomain(refreshed);
  }

  private buildOrmEntity(input: CreateShipmentInput): ShipmentOrmEntity {
    const entity = new ShipmentOrmEntity();
    entity.id = formatInternalId('Shipment');
    entity.orderId = input.orderId;
    entity.connectionId = input.connectionId;
    entity.shippingMethod = input.shippingMethod;
    entity.status = 'draft';
    entity.providerShipmentId = null;
    entity.paczkomatId = input.paczkomatId ?? null;
    entity.sourceDeliveryMethodId = input.sourceDeliveryMethodId ?? null;
    entity.trackingNumber = null;
    entity.labelPdfRef = null;
    entity.dispatchedAt = null;
    entity.deliveredAt = null;
    entity.cancelledAt = null;
    entity.failedAt = null;
    entity.errorMessage = null;
    return entity;
  }

  private buildWhere(filters: ShipmentFilters): FindOptionsWhere<ShipmentOrmEntity> {
    const where: FindOptionsWhere<ShipmentOrmEntity> = {};
    if (filters.orderId !== undefined) where.orderId = filters.orderId;
    if (filters.status !== undefined) where.status = filters.status;
    if (filters.connectionId !== undefined) where.connectionId = filters.connectionId;
    if (filters.shippingMethod !== undefined) where.shippingMethod = filters.shippingMethod;
    if (filters.hasTracking !== undefined) {
      where.trackingNumber = filters.hasTracking ? Not(IsNull()) : IsNull();
    }
    const { createdFrom, createdTo } = filters;
    if (createdFrom !== undefined && createdTo !== undefined) {
      where.createdAt = Between(createdFrom, createdTo);
    } else if (createdFrom !== undefined) {
      where.createdAt = MoreThanOrEqual(createdFrom);
    } else if (createdTo !== undefined) {
      where.createdAt = LessThanOrEqual(createdTo);
    }
    return where;
  }

  private buildUpdatePayload(patch: UpdateShipmentInput): Partial<ShipmentOrmEntity> {
    const payload: Partial<ShipmentOrmEntity> = {};
    if (patch.status !== undefined) payload.status = patch.status;
    if (patch.providerShipmentId !== undefined) {
      payload.providerShipmentId = patch.providerShipmentId;
    }
    if (patch.trackingNumber !== undefined) payload.trackingNumber = patch.trackingNumber;
    if (patch.labelPdfRef !== undefined) payload.labelPdfRef = patch.labelPdfRef;
    if (patch.dispatchedAt !== undefined) payload.dispatchedAt = patch.dispatchedAt;
    if (patch.deliveredAt !== undefined) payload.deliveredAt = patch.deliveredAt;
    if (patch.cancelledAt !== undefined) payload.cancelledAt = patch.cancelledAt;
    if (patch.failedAt !== undefined) payload.failedAt = patch.failedAt;
    if (patch.errorMessage !== undefined) payload.errorMessage = patch.errorMessage;
    return payload;
  }

  private toDomain(entity: ShipmentOrmEntity): Shipment {
    return new Shipment(
      entity.id,
      entity.orderId,
      entity.connectionId,
      entity.shippingMethod,
      entity.status,
      entity.providerShipmentId,
      entity.paczkomatId,
      entity.trackingNumber,
      entity.labelPdfRef,
      entity.dispatchedAt,
      entity.deliveredAt,
      entity.cancelledAt,
      entity.failedAt,
      entity.errorMessage,
      entity.createdAt,
      entity.updatedAt,
      entity.sourceDeliveryMethodId,
    );
  }
}
