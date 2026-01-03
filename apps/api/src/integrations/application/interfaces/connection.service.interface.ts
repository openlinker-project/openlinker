/**
 * Connection Service Interface
 *
 * Defines the contract for connection management operations in the API layer.
 * Wraps the ConnectionPort from core library with validation and error handling.
 *
 * @module apps/api/src/integrations/application/interfaces
 * @see {@link ConnectionService} for the implementation
 */
import { Connection } from '@openlinker/core/identifier-mapping/domain/entities/connection.entity';
import {
  ConnectionCreate,
  ConnectionUpdate,
  ConnectionFilters,
} from '@openlinker/core/identifier-mapping/domain/types/connection.types';

export interface IConnectionService {
  /**
   * Create a new connection
   * @param payload - Connection creation payload
   * @returns Created Connection entity
   */
  create(payload: ConnectionCreate): Promise<Connection>;

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
   * Disable a connection
   * @param connectionId - The connection identifier (UUID)
   * @returns Disabled Connection entity or throws if not found
   */
  disable(connectionId: string): Promise<Connection>;
}



