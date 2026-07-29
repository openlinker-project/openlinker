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
import { QueryFailedError, Repository } from 'typeorm';

import { OfferCreationRecord } from '../../../domain/entities/offer-creation-record.entity';
import { OfferCreationRecordNotFoundException } from '../../../domain/exceptions/offer-creation-record-not-found.exception';
import type { OfferCreationRecordRepositoryPort } from '../../../domain/ports/offer-creation-record-repository.port';
import {
  OFFER_CREATION_STATUS,
  type CreateOfferCreationRecordInput,
  type OfferCreationError,
  type OfferCreationStatus,
} from '../../../domain/types/offer-creation-record.types';
import type { SmartClassificationReport } from '../../../domain/types/smart-classification.types';
import { OfferCreationRecordOrmEntity } from '../entities/offer-creation-record.orm-entity';

@Injectable()
export class OfferCreationRecordRepository implements OfferCreationRecordRepositoryPort {
  constructor(
    @InjectRepository(OfferCreationRecordOrmEntity)
    private readonly repository: Repository<OfferCreationRecordOrmEntity>
  ) {}

  async create(input: CreateOfferCreationRecordInput): Promise<OfferCreationRecord> {
    const entity = this.buildOrmEntity(input);
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async findById(id: string): Promise<OfferCreationRecord | null> {
    try {
      const entity = await this.repository.findOne({ where: { id } });
      return entity ? this.toDomain(entity) : null;
    } catch (error) {
      // Handle invalid UUID format - PostgreSQL throws QueryFailedError
      // when trying to query with a non-UUID string
      if (
        error instanceof QueryFailedError &&
        'code' in error &&
        error.code === '22P02' // PostgreSQL invalid input syntax error code
      ) {
        return null;
      }
      throw error;
    }
  }

  async findLatestByVariantAndConnection(
    variantId: string,
    connectionId: string
  ): Promise<OfferCreationRecord | null> {
    const entity = await this.repository.findOne({
      where: { internalVariantId: variantId, connectionId },
      order: { createdAt: 'DESC' },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async findByExternalOfferIdAndConnectionId(
    externalOfferId: string,
    connectionId: string
  ): Promise<OfferCreationRecord | null> {
    const entity = await this.repository.findOne({
      where: { externalOfferId, connectionId },
    });
    return entity ? this.toDomain(entity) : null;
  }

  async updateStatus(
    id: string,
    status: OfferCreationStatus,
    errors?: OfferCreationError[] | null
  ): Promise<OfferCreationRecord> {
    let entity: OfferCreationRecordOrmEntity | null;
    try {
      entity = await this.repository.findOne({ where: { id } });
    } catch (error) {
      // Handle invalid UUID format - PostgreSQL throws QueryFailedError
      // when trying to query with a non-UUID string
      if (
        error instanceof QueryFailedError &&
        'code' in error &&
        error.code === '22P02' // PostgreSQL invalid input syntax error code
      ) {
        throw new OfferCreationRecordNotFoundException(id);
      }
      throw error;
    }
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

  async updateExternalIdAndStatus(
    id: string,
    externalOfferId: string,
    status: OfferCreationStatus,
    errors?: OfferCreationError[] | null
  ): Promise<OfferCreationRecord> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new OfferCreationRecordNotFoundException(id);
    }
    entity.externalOfferId = externalOfferId;
    entity.status = status;
    if (errors !== undefined) {
      entity.errors = errors;
    }
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async deleteById(id: string): Promise<void> {
    try {
      await this.repository.delete({ id });
    } catch (error) {
      // A malformed (non-UUID) id can never match a row — treat as a no-op
      // rather than surfacing an infrastructure error for a best-effort cleanup.
      if (
        error instanceof QueryFailedError &&
        'code' in error &&
        error.code === '22P02' // PostgreSQL invalid input syntax error code
      ) {
        return;
      }
      throw error;
    }
  }

  async findByBulkBatchId(bulkBatchId: string): Promise<OfferCreationRecord[]> {
    const entities = await this.repository.find({
      where: { bulkBatchId },
      order: { createdAt: 'ASC' },
    });
    return entities.map((entity) => this.toDomain(entity));
  }

  async updateClassificationReport(
    id: string,
    report: SmartClassificationReport | null
  ): Promise<OfferCreationRecord> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new OfferCreationRecordNotFoundException(id);
    }
    entity.classificationReport = report;
    const saved = await this.repository.save(entity);
    return this.toDomain(saved);
  }

  async resetForRetry(id: string): Promise<OfferCreationRecord> {
    const entity = await this.repository.findOne({ where: { id } });
    if (!entity) {
      throw new OfferCreationRecordNotFoundException(id);
    }
    entity.status = OFFER_CREATION_STATUS.Pending;
    entity.externalOfferId = null;
    entity.errors = null;
    entity.classificationReport = null;
    // `request` snapshot intentionally preserved — the retry rebuilds the
    // V2 payload from it.
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
    entity.request = input.request ?? null;
    entity.bulkBatchId = input.bulkBatchId ?? null;
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
      entity.request,
      entity.bulkBatchId,
      entity.classificationReport
    );
  }
}
