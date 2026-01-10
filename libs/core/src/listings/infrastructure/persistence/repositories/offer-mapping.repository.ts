/**
 * Offer Mapping Repository
 *
 * Repository implementation for offer mapping persistence operations.
 * Provides data access methods for finding and managing offer mappings,
 * with conversion between domain entities and ORM entities.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 * @implements {OfferMappingRepositoryPort}
 * @see {@link OfferMappingOrmEntity} for the database entity
 * @see {@link OfferMappingRepositoryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, QueryFailedError } from 'typeorm';
import { OfferMappingOrmEntity } from '../entities/offer-mapping.orm-entity';
import { OfferMappingRepositoryPort } from '../../../domain/ports/offer-mapping-repository.port';
import { OfferMapping } from '../../../domain/entities/offer-mapping.entity';
import { DuplicateOfferMappingError } from '../../../domain/exceptions/duplicate-offer-mapping.error';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class OfferMappingRepository implements OfferMappingRepositoryPort {
  private readonly logger = new Logger(OfferMappingRepository.name);

  constructor(
    @InjectRepository(OfferMappingOrmEntity)
    private readonly ormRepository: Repository<OfferMappingOrmEntity>,
  ) {}

  async findById(id: string): Promise<OfferMapping | null> {
    this.logger.debug(`Finding offer mapping by ID: ${id}`);

    const entity = await this.ormRepository.findOne({
      where: { id },
    });

    return entity ? this.toDomain(entity) : null;
  }

  async findByConnectionAndOffer(connectionId: string, offerId: string): Promise<OfferMapping | null> {
    this.logger.debug(`Finding offer mapping: connectionId=${connectionId}, offerId=${offerId}`);

    const entity = await this.ormRepository.findOne({
      where: { connectionId, offerId },
    });

    return entity ? this.toDomain(entity) : null;
  }

  async findByProduct(internalProductId: string): Promise<OfferMapping[]> {
    this.logger.debug(`Finding offer mappings for product: ${internalProductId}`);

    const entities = await this.ormRepository.find({
      where: { internalProductId },
    });

    return entities.map((entity) => this.toDomain(entity));
  }

  async findByConnection(connectionId: string): Promise<OfferMapping[]> {
    this.logger.debug(`Finding offer mappings for connection: ${connectionId}`);

    const entities = await this.ormRepository.find({
      where: { connectionId },
    });

    return entities.map((entity) => this.toDomain(entity));
  }

  async create(mapping: OfferMapping): Promise<OfferMapping> {
    this.logger.debug(
      `Creating offer mapping: connectionId=${mapping.connectionId}, offerId=${mapping.offerId}, productId=${mapping.internalProductId}`,
    );

    try {
      const entity = this.toOrm(mapping);
      const saved = await this.ormRepository.save(entity);
      this.logger.debug(`Offer mapping created: id=${saved.id}`);
      return this.toDomain(saved);
    } catch (error) {
      if (error instanceof QueryFailedError) {
        // Check if it's a unique constraint violation
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('unique') || errorMessage.includes('duplicate') || errorMessage.includes('duplicate key value')) {
          this.logger.error(
            `Duplicate offer mapping: connectionId=${mapping.connectionId}, offerId=${mapping.offerId}`,
          );
          // Throw domain-level error instead of infrastructure error
          throw new DuplicateOfferMappingError(
            mapping.connectionId,
            mapping.offerId,
          );
        }
      }
      this.logger.error(`Failed to create offer mapping: ${(error as Error).message}`, error);
      throw error;
    }
  }

  async update(mapping: OfferMapping): Promise<OfferMapping> {
    this.logger.debug(`Updating offer mapping: id=${mapping.id}`);

    if (!mapping.id) {
      throw new Error('Cannot update offer mapping without ID');
    }

    const existing = await this.ormRepository.findOne({ where: { id: mapping.id } });
    if (!existing) {
      throw new Error(`Offer mapping not found: id=${mapping.id}`);
    }

    const entity = this.toOrm(mapping);
    const saved = await this.ormRepository.save(entity);
    this.logger.debug(`Offer mapping updated: id=${saved.id}`);
    return this.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    this.logger.debug(`Deleting offer mapping: id=${id}`);

    const result = await this.ormRepository.delete(id);
    if (result.affected === 0) {
      throw new Error(`Offer mapping not found: id=${id}`);
    }

    this.logger.debug(`Offer mapping deleted: id=${id}`);
  }

  /**
   * Convert ORM entity to domain entity
   */
  private toDomain(entity: OfferMappingOrmEntity): OfferMapping {
    return new OfferMapping(
      entity.id,
      entity.connectionId,
      entity.platformType,
      entity.offerId,
      entity.internalProductId,
      entity.variantId,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  /**
   * Convert domain entity to ORM entity
   */
  private toOrm(mapping: OfferMapping): OfferMappingOrmEntity {
    const entity = new OfferMappingOrmEntity();
    if (mapping.id) {
      entity.id = mapping.id;
    }
    entity.connectionId = mapping.connectionId;
    entity.platformType = mapping.platformType;
    entity.offerId = mapping.offerId;
    entity.internalProductId = mapping.internalProductId;
    entity.variantId = mapping.variantId;
    entity.createdAt = mapping.createdAt;
    entity.updatedAt = mapping.updatedAt;
    return entity;
  }
}

