/**
 * Customer Projection Repository Port
 *
 * Defines the contract for customer projection persistence operations.
 * This port interface specifies the persistence methods needed by application
 * services, without exposing infrastructure details (TypeORM, database, etc.).
 *
 * Implemented by CustomerProjectionRepository in the infrastructure layer
 * to provide data access capabilities while maintaining proper dependency
 * direction (application → domain, not application → infrastructure).
 *
 * @module libs/core/src/customers/domain/ports
 * @see {@link CustomerProjectionRepository} for the implementation
 */
import type { CustomerProjection } from '../entities/customer-projection.entity';
import type { CustomerAddressProjection } from '../entities/customer-address-projection.entity';
import type { DestinationAddressMapping } from '../entities/destination-address-mapping.entity';
import type {
  AddressType,
  CustomerProjectionFilters,
  CustomerProjectionPagination,
  PaginatedCustomerProjections,
} from '../types/customer-projection.types';

export interface CustomerProjectionRepositoryPort {
  /**
   * Find customer projection by internal customer ID
   */
  findById(internalCustomerId: string): Promise<CustomerProjection | null>;

  /**
   * Find customer projections by email hash
   * Returns array to support collision detection (0, 1, or >1 matches)
   */
  findByEmailHash(emailHash: string): Promise<CustomerProjection[]>;

  /**
   * Find customer projections matching filters with offset pagination.
   * Results are ordered by lastSeenAt DESC.
   */
  findMany(
    filters: CustomerProjectionFilters,
    pagination: CustomerProjectionPagination
  ): Promise<PaginatedCustomerProjections>;

  /**
   * Upsert customer projection (insert or update)
   * Idempotent operation - updates lastSeenAt and other fields if exists
   */
  upsert(projection: CustomerProjection): Promise<CustomerProjection>;

  /**
   * Find all address projections for a customer
   */
  findAddressesByCustomerId(internalCustomerId: string): Promise<CustomerAddressProjection[]>;

  /**
   * Upsert customer address projection (insert or update)
   * Idempotent operation - updates lastSeenAt if exists
   */
  upsertAddress(address: CustomerAddressProjection): Promise<CustomerAddressProjection>;

  /**
   * Find destination address mapping
   * Used for address reuse lookup
   */
  findDestinationAddressMapping(
    internalCustomerId: string,
    destinationConnectionId: string,
    addressHash: string,
    addressType: AddressType
  ): Promise<DestinationAddressMapping | null>;

  /**
   * Upsert destination address mapping (insert or update)
   * Idempotent operation for address reuse tracking
   */
  upsertDestinationAddressMapping(
    mapping: DestinationAddressMapping
  ): Promise<DestinationAddressMapping>;
}
