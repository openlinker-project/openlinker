/**
 * Customer Projection Service Interface
 *
 * Defines the contract for customer projection operations. This interface
 * specifies the service methods needed by application services, without
 * exposing implementation details.
 *
 * Implemented by CustomerProjectionService in the application layer.
 *
 * @module libs/core/src/customers/application/interfaces
 * @see {@link CustomerProjectionService} for the implementation
 */
import { CustomerProjection } from '../../domain/entities/customer-projection.entity';
import { CustomerAddressProjection } from '../../domain/entities/customer-address-projection.entity';
import { DestinationAddressMapping } from '../../domain/entities/destination-address-mapping.entity';

export interface ICustomerProjectionService {
  /**
   * Get customer projection by internal id, or null if missing.
   *
   * Used by callers that need to merge with existing projection state
   * (e.g. backfilling names from an order without clobbering values that
   * are already populated). Returns the domain entity, not the ORM row.
   */
  getProjection(internalCustomerId: string): Promise<CustomerProjection | null>;

  /**
   * Upsert customer projection
   * Updates lastSeenAt and other fields if projection exists
   */
  upsertProjection(projection: CustomerProjection): Promise<CustomerProjection>;

  /**
   * Upsert customer address projection
   * Updates lastSeenAt if address projection exists
   */
  upsertAddressProjection(address: CustomerAddressProjection): Promise<CustomerAddressProjection>;

  /**
   * Upsert destination address mapping
   * Stores mapping for address reuse across orders
   */
  upsertDestinationAddressMapping(
    mapping: DestinationAddressMapping,
  ): Promise<DestinationAddressMapping>;
}

// Re-export token for convenience
export { CUSTOMER_PROJECTION_SERVICE_TOKEN } from '../../customers.tokens';
