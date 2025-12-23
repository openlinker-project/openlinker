/**
 * Connection Port
 *
 * Defines the contract for Connection retrieval operations. Implemented by
 * ConnectionRepository to provide Connection lookup capabilities for the
 * identifier mapping service.
 *
 * @module libs/core/src/identifier-mapping/domain/ports
 * @see {@link ConnectionRepository} for the implementation
 */
import { Connection } from '../entities/connection.entity';

export interface ConnectionPort {
  /**
   * Get connection by ID
   * @param connectionId - The connection identifier (UUID)
   * @returns Connection entity or throws if not found
   */
  get(connectionId: string): Promise<Connection>;
}



