/**
 * Listing Creation Record Repository
 *
 * TypeORM implementation of `ListingCreationRecordRepositoryPort` (#1042).
 * Handles ORM ↔ domain mapping privately; callers receive domain entities only.
 * Throws `ListingCreationRecordNotFoundException` on update paths when the row
 * does not exist.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {ListingCreationRecordRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ListingCreationRecord } from '../../../domain/entities/listing-creation-record.entity';
import { ListingCreationRecordNotFoundException } from '../../../domain/exceptions/listing-creation-record-not-found.exception';
import type { ListingCreationRecordRepositoryPort } from '../../../domain/ports/listing-creation-record-repository.port';
import type {
  CreateListingCreationRecordInput,
  ListingCreationError,
  ListingCreationStatus,
} from '../../../domain/types/listing-creation-record.types';
import { ListingCreationRecordOrmEntity } from '../entities/listing-creation-record.orm-entity';

@Injectable()
export class ListingCreationRecordRepository implements ListingCreationRecordRepositoryPort {
  constructor(
    @InjectRepository(ListingCreationRecordOrmEntity)
    private readonly repository: Repository<ListingCreationRecordOrmEntity>
  ) {}

  async create(input: CreateListingCreationRecordInput): Promise<ListingCreationRecord> {
    const entity = this.buildOrmEntity(input);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findById(id: string): Promise<ListingCreationRecord | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findLatestByVariantAndConnection(
    variantId: string,
    connectionId: string
  ): Promise<ListingCreationRecord | null> {
    const entity = await this.repository.findOne({
      where: { internalVariantId: variantId, connectionId },
      order: { createdAt: 'DESC' },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findByExternalProductIdAndConnectionId(
    externalProductId: string,
    connectionId: string
  ): Promise<ListingCreationRecord | null> {
    const entity = await this.repository.findOne({
      where: { externalProductId, connectionId },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async updateStatus(
    id: string,
    status: ListingCreationStatus,
    errors?: ListingCreationError[] | null
  ): Promise<ListingCreationRecord> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new ListingCreationRecordNotFoundException(id);
    }
    entity.status = status;
    if (errors !== undefined) {
      entity.errors = errors;
    }
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async updateExternalIdAndStatus(
    id: string,
    externalProductId: string,
    status: ListingCreationStatus,
    errors?: ListingCreationError[] | null
  ): Promise<ListingCreationRecord> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new ListingCreationRecordNotFoundException(id);
    }
    entity.externalProductId = externalProductId;
    entity.status = status;
    if (errors !== undefined) {
      entity.errors = errors;
    }
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  private buildOrmEntity(input: CreateListingCreationRecordInput): ListingCreationRecordOrmEntity {
    const entity = new ListingCreationRecordOrmEntity();
    entity.internalVariantId = input.internalVariantId;
    entity.connectionId = input.connectionId;
    entity.status = input.status;
    entity.externalProductId = input.externalProductId ?? null;
    entity.errors = input.errors ?? null;
    return entity;
  }

  private toDomain(entity: ListingCreationRecordOrmEntity): ListingCreationRecord {
    return new ListingCreationRecord(
      entity.id,
      entity.internalVariantId,
      entity.connectionId,
      entity.externalProductId,
      entity.status,
      entity.errors,
      entity.createdAt,
      entity.updatedAt
    );
  }
}
