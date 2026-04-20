/**
 * Offer Creation Record Repository
 *
 * TypeORM implementation of `OfferCreationRecordRepositoryPort`. Handles all
 * ORM ↔ domain mapping privately; callers receive domain entities only.
 * Throws `OfferCreationRecordNotFoundException` on update paths when the row
 * does not exist.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {OfferCreationRecordRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { OfferCreationRecord } from '../../../domain/entities/offer-creation-record.entity';
import { OfferCreationRecordNotFoundException } from '../../../domain/exceptions/offer-creation-record-not-found.exception';
import { OfferCreationRecordRepositoryPort } from '../../../domain/ports/offer-creation-record-repository.port';
import {
  CreateOfferCreationRecordInput,
  OfferCreationError,
  OfferCreationStatus,
} from '../../../domain/types/offer-creation-record.types';
import { OfferCreationRecordOrmEntity } from '../entities/offer-creation-record.orm-entity';

@Injectable()
export class OfferCreationRecordRepository implements OfferCreationRecordRepositoryPort {
  constructor(
    @InjectRepository(OfferCreationRecordOrmEntity)
    private readonly repository: Repository<OfferCreationRecordOrmEntity>,
  ) {}

  async create(input: CreateOfferCreationRecordInput): Promise<OfferCreationRecord> {
    const entity = this.buildOrmEntity(input);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findById(id: string): Promise<OfferCreationRecord | null> {
    const entity = await this.repository.findOne({ where: { id } });
    return entity ? this.toDomain(entity) : null;
  }

  async findLatestByVariantAndConnection(
    variantId: string,
    connectionId: string,
  ): Promise<OfferCreationRecord | null> {
    const entity = await this.repository.findOne({
      where: { internalVariantId: variantId, connectionId },
      order: { createdAt: 'DESC' },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async updateStatus(
    id: string,
    status: OfferCreationStatus,
    errors?: OfferCreationError[] | null,
  ): Promise<OfferCreationRecord> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new OfferCreationRecordNotFoundException(id);
    }
    entity.status = status;
    if (errors !== undefined) {
      entity.errors = errors;
    }
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async updateExternalOfferId(id: string, externalOfferId: string): Promise<OfferCreationRecord> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new OfferCreationRecordNotFoundException(id);
    }
    entity.externalOfferId = externalOfferId;
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  private buildOrmEntity(input: CreateOfferCreationRecordInput): OfferCreationRecordOrmEntity {
    const entity = new OfferCreationRecordOrmEntity();
    entity.internalVariantId = input.internalVariantId;
    entity.connectionId = input.connectionId;
    entity.status = input.status;
    entity.publishImmediately = input.publishImmediately;
    entity.externalOfferId = input.externalOfferId ?? null;
    entity.errors = input.errors ?? null;
    return entity;
  }

  private toDomain(entity: OfferCreationRecordOrmEntity): OfferCreationRecord {
    return new OfferCreationRecord(
      entity.id,
      entity.internalVariantId,
      entity.connectionId,
      entity.externalOfferId,
      entity.status,
      entity.errors,
      entity.publishImmediately,
      entity.createdAt,
      entity.updatedAt,
    );
  }
}
