/**
 * Offer Mapping Service
 *
 * Application service for offer mapping operations. Provides CRUD capabilities
 * for managing marketplace offer to product mappings.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IOfferMappingService}
 * @see {@link IOfferMappingService} for the service interface
 * @see {@link OfferMappingRepositoryPort} for persistence port
 */
import { Injectable, Inject } from '@nestjs/common';
import { IOfferMappingService } from '../interfaces/offer-mapping.service.interface';
import { OfferMappingRepositoryPort } from '../../domain/ports/offer-mapping-repository.port';
import { OfferMapping } from '../../domain/entities/offer-mapping.entity';
import { Logger } from '@openlinker/shared/logging';
import { OFFER_MAPPING_REPOSITORY_TOKEN } from '../../listings.tokens';

@Injectable()
export class OfferMappingService implements IOfferMappingService {
  private readonly logger = new Logger(OfferMappingService.name);

  constructor(
    @Inject(OFFER_MAPPING_REPOSITORY_TOKEN)
    private readonly repository: OfferMappingRepositoryPort,
  ) {}

  async create(
    connectionId: string,
    platformType: string,
    offerId: string,
    internalProductId: string,
    variantId?: string | null,
  ): Promise<OfferMapping> {
    this.logger.debug(
      `Creating offer mapping: connectionId=${connectionId}, offerId=${offerId}, productId=${internalProductId}`,
    );

    const mapping = OfferMapping.create(connectionId, platformType, offerId, internalProductId, variantId);
    return this.repository.create(mapping);
  }

  async findById(id: string): Promise<OfferMapping | null> {
    this.logger.debug(`Finding offer mapping by ID: ${id}`);
    return this.repository.findById(id);
  }

  async findByConnectionAndOffer(connectionId: string, offerId: string): Promise<OfferMapping | null> {
    this.logger.debug(`Finding offer mapping: connectionId=${connectionId}, offerId=${offerId}`);
    return this.repository.findByConnectionAndOffer(connectionId, offerId);
  }

  async findByProduct(internalProductId: string): Promise<OfferMapping[]> {
    this.logger.debug(`Finding offer mappings for product: ${internalProductId}`);
    return this.repository.findByProduct(internalProductId);
  }

  async findByConnection(connectionId: string): Promise<OfferMapping[]> {
    this.logger.debug(`Finding offer mappings for connection: ${connectionId}`);
    return this.repository.findByConnection(connectionId);
  }

  async update(
    id: string,
    updates: {
      internalProductId?: string;
      variantId?: string | null;
    },
  ): Promise<OfferMapping> {
    this.logger.debug(`Updating offer mapping: id=${id}`);

    const existing = await this.repository.findById(id);
    if (!existing) {
      throw new Error(`Offer mapping not found: id=${id}`);
    }

    const updated = new OfferMapping(
      existing.id,
      existing.connectionId,
      existing.platformType,
      existing.offerId,
      updates.internalProductId ?? existing.internalProductId,
      updates.variantId !== undefined ? updates.variantId : existing.variantId,
      existing.createdAt,
      new Date(), // Update timestamp
    );

    return this.repository.update(updated);
  }

  async delete(id: string): Promise<void> {
    this.logger.debug(`Deleting offer mapping: id=${id}`);
    await this.repository.delete(id);
  }
}

