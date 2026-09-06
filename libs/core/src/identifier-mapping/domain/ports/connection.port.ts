/**
 * Connection Port
 *
 * Defines the contract for Connection CRUD operations. Implemented by
 * ConnectionRepository to provide Connection persistence capabilities for the
 * identifier mapping service and integrations service.
 *
 * @module libs/core/src/identifier-mapping/domain/ports
 * @see {@link ConnectionRepository} for the implementation
 */
import type { Connection } from '../entities/connection.entity';
import type {
  ConnectionCreate,
  ConnectionUpdate,
  ConnectionFilters,
  ConnectionPagination,
  PaginatedConnections,
} from '../types/connection.types';

export interface ConnectionPort {
  /**
   * Get connection by ID
   * @param connectionId - The connection identifier (UUID)
   * @returns Connection entity or throws if not found
   */
  get(connectionId: string): Promise<Connection>;

  /**
   * List connections with optional filters
   * @param filters - Optional filter criteria (platformType, status)
   * @returns Array of Connection entities matching the filters
   */
  list(filters?: ConnectionFilters): Promise<Connection[]>;

  /**
   * List connections with optional filters, paged (#2937). A separate
   * method from {@link list} on purpose — see `ConnectionPagination`'s
   * docblock for why the two must not collapse into one signature.
   * @param filters - Optional filter criteria (platformType, status)
   * @param pagination - Page bounds
   * @returns A page of Connection entities plus the total matching count
   */
  listPaginated(
    filters: ConnectionFilters | undefined,
    pagination: ConnectionPagination
  ): Promise<PaginatedConnections>;

  /**
   * Create a new connection
   * @param payload - Connection creation payload
   * @returns Created Connection entity
   */
  create(payload: ConnectionCreate): Promise<Connection>;

  /**
   * Update an existing connection
   * @param connectionId - The connection identifier (UUID)
   * @param patch - Partial update payload
   * @returns Updated Connection entity or throws if not found
   */
  update(connectionId: string, patch: ConnectionUpdate): Promise<Connection>;

  /**
   * Disable a connection
   * Sets the connection status to 'disabled'. Hard delete is not recommended
   * because IdentifierMapping uses connectionId as a namespace. Disabling
   * preserves historical data and prevents orphaned mappings.
   * @param connectionId - The connection identifier (UUID)
   * @returns Disabled Connection entity or throws if not found
   */
  disable(connectionId: string): Promise<Connection>;
}
