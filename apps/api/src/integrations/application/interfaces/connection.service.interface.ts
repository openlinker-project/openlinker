/**
 * Connection Service Interface
 *
 * Defines the contract for connection management operations in the API layer.
 * Wraps the ConnectionPort from core library with validation and error handling.
 *
 * @module apps/api/src/integrations/application/interfaces
 * @see {@link ConnectionService} for the implementation
 */
import { Connection, ConnectionCreate, ConnectionUpdate, ConnectionFilters } from '@openlinker/core/identifier-mapping';

/**
 * Connection create input accepted by the API service.
 *
 * Extends the core `ConnectionCreate` with an optional `credentials` payload.
 * When `credentials` is supplied, the service persists it in the integration
 * credentials store and sets `credentialsRef` to the resulting `db:<uuid>`
 * automatically. Exactly one of `credentials` or `credentialsRef` must be set.
 */
export type ConnectionCreateInput = Omit<ConnectionCreate, 'credentialsRef'> & {
  credentialsRef?: string;
  credentials?: Record<string, unknown>;
};

export interface IConnectionService {
  /**
   * Create a new connection
   * @param payload - Connection creation payload
   * @returns Created Connection entity
   */
  create(payload: ConnectionCreateInput): Promise<Connection>;

  /**
   * List connections with optional filters
   * @param filters - Optional filter criteria
   * @returns Array of Connection entities
   */
  list(filters?: ConnectionFilters): Promise<Connection[]>;

  /**
   * Get connection by ID
   * @param connectionId - The connection identifier (UUID)
   * @returns Connection entity or throws if not found
   */
  get(connectionId: string): Promise<Connection>;

  /**
   * Update an existing connection
   * @param connectionId - The connection identifier (UUID)
   * @param patch - Partial update payload
   * @returns Updated Connection entity or throws if not found
   */
  update(connectionId: string, patch: ConnectionUpdate): Promise<Connection>;

  /**
   * Rotate the credentials stored for a connection. Writes to the credential
   * row referenced by `credentialsRef`; the connection row is not modified.
   *
   * @param connectionId - The connection identifier (UUID)
   * @param credentials - Platform-specific credential payload (replaces stored value)
   */
  updateCredentials(
    connectionId: string,
    credentials: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Disable a connection
   * @param connectionId - The connection identifier (UUID)
   * @returns Disabled Connection entity or throws if not found
   */
  disable(connectionId: string): Promise<Connection>;
}
