/**
 * Offer Mapping Service Interface
 *
 * Defines the contract for offer mapping operations. Implemented by
 * OfferMappingService to provide offer mapping management capabilities.
 *
 * @module libs/core/src/listings/application/interfaces
 * @see {@link OfferMappingService} for the implementation
 */
import { OfferMapping } from '../../domain/entities/offer-mapping.entity';

/**
 * Offer Mapping Service Interface
 *
 * Application service for offer mapping operations. Provides CRUD capabilities
 * for managing marketplace offer to product mappings.
 */
export interface IOfferMappingService {
  /**
   * Create a new offer mapping
   *
   * @param connectionId - Connection identifier (UUID)
   * @param platformType - Platform type (e.g., 'allegro')
   * @param offerId - Marketplace offer ID
   * @param internalProductId - Internal OpenLinker product ID
   * @param variantId - Optional variant ID
   * @returns Created offer mapping
   * @throws Error if mapping already exists
   */
  create(
    connectionId: string,
    platformType: string,
    offerId: string,
    internalProductId: string,
    variantId?: string | null,
  ): Promise<OfferMapping>;

  /**
   * Find mapping by ID
   *
   * @param id - Offer mapping ID (UUID)
   * @returns Offer mapping or null if not found
   */
  findById(id: string): Promise<OfferMapping | null>;

  /**
   * Find mapping by connection and offer ID
   *
   * @param connectionId - Connection identifier (UUID)
   * @param offerId - Marketplace offer ID
   * @returns Offer mapping or null if not found
   */
  findByConnectionAndOffer(connectionId: string, offerId: string): Promise<OfferMapping | null>;

  /**
   * Find all mappings for a product
   *
   * @param internalProductId - Internal OpenLinker product ID
   * @returns Array of offer mappings
   */
  findByProduct(internalProductId: string): Promise<OfferMapping[]>;

  /**
   * Find all mappings for a connection
   *
   * @param connectionId - Connection identifier (UUID)
   * @returns Array of offer mappings
   */
  findByConnection(connectionId: string): Promise<OfferMapping[]>;

  /**
   * Update an existing offer mapping
   *
   * @param id - Offer mapping ID
   * @param updates - Partial update data
   * @returns Updated offer mapping
   * @throws Error if mapping not found
   */
  update(
    id: string,
    updates: {
      internalProductId?: string;
      variantId?: string | null;
    },
  ): Promise<OfferMapping>;

  /**
   * Delete an offer mapping
   *
   * @param id - Offer mapping ID
   * @throws Error if mapping not found
   */
  delete(id: string): Promise<void>;
}

