/**
 * Status Mapping Repository Port
 *
 * Persistence contract for status mapping operations.
 * Implemented by the infrastructure layer.
 *
 * @module libs/core/src/mappings/domain/ports
 */

import type { StatusMapping } from '../entities/status-mapping.entity';
import type { StatusMappingInput } from '../types/mapping.types';

export interface StatusMappingRepositoryPort {
  findByConnectionId(connectionId: string): Promise<StatusMapping[]>;
  /**
   * Replace all mappings for a connection atomically (delete + insert in transaction).
   */
  replaceForConnection(connectionId: string, items: StatusMappingInput[]): Promise<StatusMapping[]>;
}
