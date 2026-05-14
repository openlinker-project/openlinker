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
