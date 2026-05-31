/**
 * Order State Mapping Repository Port
 *
 * Persistence contract for the outbound OL→destination order-state override
 * mapping (#862). Implemented by the infrastructure layer.
 *
 * @module libs/core/src/mappings/domain/ports
 */

import type { OrderStateMapping } from '../entities/order-state-mapping.entity';
import type { OrderStateMappingInput } from '../types/mapping.types';

export interface OrderStateMappingRepositoryPort {
  findByConnectionId(connectionId: string): Promise<OrderStateMapping[]>;
  /**
   * Replace all mappings for a connection atomically (delete + insert in transaction).
   */
  replaceForConnection(
    connectionId: string,
    items: OrderStateMappingInput[]
  ): Promise<OrderStateMapping[]>;
}
