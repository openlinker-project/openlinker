/**
 * Offer Mapping Repository Port
 *
 * Defines the contract for offer mapping persistence operations. This port
 * interface specifies the persistence methods needed by application services,
 * without exposing infrastructure details (TypeORM, database, etc.).
 *
 * @module libs/core/src/listings/domain/ports
 * @see {@link OfferMappingRepository} for the implementation
 */
import { OfferMapping } from '../entities/offer-mapping.entity';

/**
 * Offer Mapping Repository Port
 *
 * Interface for offer mapping persistence operations. Implementations handle
 * the specifics of the underlying database technology.
 */
export interface OfferMappingRepositoryPort {
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
   * Create a new offer mapping
   *
   * @param mapping - Offer mapping domain entity
   * @returns Created offer mapping with generated ID
   * @throws Error if unique constraint violation (duplicate offerId for connection)
   */
  create(mapping: OfferMapping): Promise<OfferMapping>;

  /**
   * Update an existing offer mapping
   *
   * @param mapping - Offer mapping domain entity with updated values
   * @returns Updated offer mapping
   * @throws Error if mapping not found
   */
  update(mapping: OfferMapping): Promise<OfferMapping>;

  /**
   * Delete an offer mapping
   *
   * @param id - Offer mapping ID
   * @throws Error if mapping not found
   */
  delete(id: string): Promise<void>;
}

