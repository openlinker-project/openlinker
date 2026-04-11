/**
 * Mapping Config Service Interface
 *
 * Contract for connection-scoped mapping configuration operations.
 * Covers status, carrier, and payment mapping types.
 *
 * @module libs/core/src/mappings/application/interfaces
 */

import { StatusMapping } from '../../domain/entities/status-mapping.entity';
import { CarrierMapping } from '../../domain/entities/carrier-mapping.entity';
import { PaymentMapping } from '../../domain/entities/payment-mapping.entity';
import {
  StatusMappingInput,
  CarrierMappingInput,
  PaymentMappingInput,
} from '../../domain/types/mapping.types';

export interface IMappingConfigService {
  getStatusMappings(connectionId: string): Promise<StatusMapping[]>;
  upsertStatusMappings(connectionId: string, items: StatusMappingInput[]): Promise<StatusMapping[]>;

  getCarrierMappings(connectionId: string): Promise<CarrierMapping[]>;
  upsertCarrierMappings(connectionId: string, items: CarrierMappingInput[]): Promise<CarrierMapping[]>;

  getPaymentMappings(connectionId: string): Promise<PaymentMapping[]>;
  upsertPaymentMappings(connectionId: string, items: PaymentMappingInput[]): Promise<PaymentMapping[]>;

  /**
   * Resolve configured PrestaShop status ID for a given Allegro status.
   * Returns null if no mapping is configured for this connection + allegroStatus pair.
   */
  resolveStatusMapping(connectionId: string, allegroStatus: string): Promise<string | null>;
}
