/**
 * Carrier Mapping Repository Port
 *
 * Persistence contract for carrier mapping operations.
 * Implemented by the infrastructure layer.
 *
 * @module libs/core/src/mappings/domain/ports
 */

import { CarrierMapping } from '../entities/carrier-mapping.entity';
import { CarrierMappingInput } from '../types/mapping.types';

export interface CarrierMappingRepositoryPort {
  findByConnectionId(connectionId: string): Promise<CarrierMapping[]>;
  /**
   * Replace all mappings for a connection atomically (delete + insert in transaction).
   */
  replaceForConnection(connectionId: string, items: CarrierMappingInput[]): Promise<CarrierMapping[]>;
}
