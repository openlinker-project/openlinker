/**
 * Mapping Config Service Interface
 *
 * Contract for connection-scoped mapping configuration operations.
 * Covers status, carrier, and payment mapping types.
 *
 * @module libs/core/src/mappings/application/interfaces
 */

import type { OrderStatus } from '@openlinker/core/orders';
import type { StatusMapping } from '../../domain/entities/status-mapping.entity';
import type { CarrierMapping } from '../../domain/entities/carrier-mapping.entity';
import type { PaymentMapping } from '../../domain/entities/payment-mapping.entity';
import type { CategoryMapping } from '../../domain/entities/category-mapping.entity';
import type { OrderStateMapping } from '../../domain/entities/order-state-mapping.entity';
import type {
  StatusMappingInput,
  CarrierMappingInput,
  PaymentMappingInput,
  CategoryMappingInput,
  OrderStateMappingInput,
} from '../../domain/types/mapping.types';

export interface IMappingConfigService {
  getStatusMappings(connectionId: string): Promise<StatusMapping[]>;
  upsertStatusMappings(connectionId: string, items: StatusMappingInput[]): Promise<StatusMapping[]>;

  getCarrierMappings(connectionId: string): Promise<CarrierMapping[]>;
  upsertCarrierMappings(
    connectionId: string,
    items: CarrierMappingInput[]
  ): Promise<CarrierMapping[]>;

  getPaymentMappings(connectionId: string): Promise<PaymentMapping[]>;
  upsertPaymentMappings(
    connectionId: string,
    items: PaymentMappingInput[]
  ): Promise<PaymentMapping[]>;

  /**
   * Resolve configured PrestaShop status ID for a given Allegro status.
   * Returns null if no mapping is configured for this connection + allegroStatus pair.
   */
  resolveStatusMapping(connectionId: string, allegroStatus: string): Promise<string | null>;

  /**
   * Resolve the configured PrestaShop carrier ID for a given Allegro delivery method.
   *
   * `connectionId` is the **source** connection (Allegro) — same scoping convention
   * as `resolveStatusMapping`. Returns null if no mapping is configured for this
   * connection + allegroDeliveryMethodId pair; the caller is expected to fall back
   * to a default carrier id (configured per destination connection) and ultimately
   * to PrestaShop's `id_carrier=1` if neither is available.
   */
  resolveCarrierMapping(
    connectionId: string,
    allegroDeliveryMethodId: string
  ): Promise<string | null>;

  getOrderStateMappings(connectionId: string): Promise<OrderStateMapping[]>;
  upsertOrderStateMappings(
    connectionId: string,
    items: OrderStateMappingInput[]
  ): Promise<OrderStateMapping[]>;

  /**
   * Resolve the configured destination order-state id for a given OL status (#862).
   *
   * `connectionId` is the **destination** connection (the shop whose state
   * catalogue is customised) — unlike `resolveStatusMapping` /
   * `resolveCarrierMapping`, which are source-scoped. Returns null when no
   * override is configured; the adapter then falls back to its hardcoded
   * default-install map.
   */
  resolveOrderStateMapping(connectionId: string, olStatus: OrderStatus): Promise<string | null>;

  getCategoryMappings(destinationConnectionId: string): Promise<CategoryMapping[]>;
  upsertCategoryMapping(
    destinationConnectionId: string,
    input: CategoryMappingInput
  ): Promise<CategoryMapping>;
  deleteCategoryMapping(destinationConnectionId: string, sourceCategoryId: string): Promise<void>;

  /**
   * Resolve the configured destination category ID for a given source category.
   * `destinationConnectionId` is the marketplace/shop connection the mapping
   * targets. Returns null if no mapping is configured for this destination +
   * sourceCategoryId pair.
   */
  resolveDestinationCategory(
    destinationConnectionId: string,
    sourceCategoryId: string
  ): Promise<string | null>;
}
