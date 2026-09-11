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
   *
   * Rows AND total in one call. Unchanged by #2944 and still the right choice
   * for a caller that wants both at once - see {@link findManyRows} for why it
   * is not composed from the two split reads.
   */
  findMany(
    filters: CustomerProjectionFilters,
    pagination: CustomerProjectionPagination
  ): Promise<PaginatedCustomerProjections>;

  /**
   * The page WITHOUT its total (#2944).
   *
   * A paged read stops after its `LIMIT`; the `COUNT` beside it cannot stop at
   * all, so under a predicate no plain index serves - here the four-column
   * `ILIKE` search - the count scans the table however small the page is. This
   * read pays only for the page.
   *
   * It applies the identical predicate to {@link countMany}: both are built by
   * one private `buildFilteredQuery`, so the total can never describe a
   * different set than the page.
   *
   * {@link findMany} deliberately does NOT delegate to this method plus
   * {@link countMany}. It keeps the single `getManyAndCount()` it already had,
   * so `?withTotal=true` - the default, and every caller not yet migrated -
   * emits exactly the two statements it emitted before #2944, on the one query
   * runner it emitted them on. Composing would be a second, unmeasured change
   * (two pool connections per list request) smuggled into a change about
   * something else.
   *
   * Note what that does NOT claim. Read against typeorm@0.3.17 rather than
   * assumed: `getManyAndCount` runs `executeEntitiesAndRawResults` and then
   * `executeCountQuery` unconditionally and sequentially. There is no
   * short-page branch and no `lazyCount` - the identifier does not exist in
   * that version. The count always runs, which is the argument FOR splitting
   * it out, not against.
   */
  findManyRows(
    filters: CustomerProjectionFilters,
    pagination: CustomerProjectionPagination
  ): Promise<CustomerProjection[]>;

  /**
   * The total WITHOUT its page (#2944) - the second half of {@link findManyRows}.
   *
   * Takes no pagination, which is the point: the answer depends on the filters
   * alone, so a caller may cache it per filter combination and paging through
   * a result set never recomputes it.
   */
  countMany(filters: CustomerProjectionFilters): Promise<number>;

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
