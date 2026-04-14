/**
 * Connection Service Interface
 *
 * Defines the contract for connection management operations in the API layer.
 * Wraps the ConnectionPort from core library with validation and error handling.
 *
 * @module apps/api/src/integrations/application/interfaces
 * @see {@link ConnectionService} for the implementation
 */
import { Connection, ConnectionUpdate, ConnectionFilters } from '@openlinker/core/identifier-mapping';
import { ConnectionTestResult } from '@openlinker/core/integrations';
import { ConnectionCreateInput } from './connection.service.types';

export type { ConnectionCreateInput };

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
   * Probe the connection using its adapter-specific tester. Never throws on
   * network/auth failures — always returns a structured result for the UI.
   *
   * @param connectionId - The connection identifier (UUID)
   * @returns Structured test result
   */
  testConnection(connectionId: string): Promise<ConnectionTestResult>;

  /**
   * Disable a connection
   * @param connectionId - The connection identifier (UUID)
   * @returns Disabled Connection entity or throws if not found
   */
  disable(connectionId: string): Promise<Connection>;
}
