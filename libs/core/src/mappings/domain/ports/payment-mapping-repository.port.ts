/**
 * Payment Mapping Repository Port
 *
 * Persistence contract for payment mapping operations.
 * Implemented by the infrastructure layer.
 *
 * @module libs/core/src/mappings/domain/ports
 */

import type { PaymentMapping } from '../entities/payment-mapping.entity';
import type { PaymentMappingInput } from '../types/mapping.types';

export interface PaymentMappingRepositoryPort {
  findByConnectionId(connectionId: string): Promise<PaymentMapping[]>;
  /**
   * Replace all mappings for a connection atomically (delete + insert in transaction).
   */
  replaceForConnection(
    connectionId: string,
    items: PaymentMappingInput[]
  ): Promise<PaymentMapping[]>;
}
