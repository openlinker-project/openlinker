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
import type { AttributeMapping } from '../../domain/entities/attribute-mapping.entity';
import type {
  StatusMappingInput,
  CarrierMappingInput,
  PaymentMappingInput,
  CategoryMappingInput,
  OrderStateMappingInput,
  AttributeMappingInput,
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
   * targets. Tries a destination-keyed row first (an explicit row for this
   * connection wins); when none and `opts.borrowedTaxonomy` is set, falls back to
   * an owner-authored row under that provenance (#1045) so a `borrows` destination
   * (ERLI) reuses an Allegro mapping with zero re-authoring. `opts.sourceConnectionId`
   * scopes the fallback to the right source store. Returns null when nothing matches.
   */
  resolveDestinationCategory(
    destinationConnectionId: string,
    sourceCategoryId: string,
    opts?: { borrowedTaxonomy?: string; sourceConnectionId?: string }
  ): Promise<string | null>;

  /**
   * Attribute mappings for a destination connection (#1038, ADR-023 §4) — the
   * full set across source connections and categories, each with its value
   * translations. The projection service filters by source connection +
   * category in memory.
   */
  getAttributeMappings(destinationConnectionId: string): Promise<AttributeMapping[]>;
  /**
   * Attribute mappings authored under a given owner-taxonomy provenance (#1045),
   * across destination connections — the borrowed-taxonomy reuse source for a
   * `borrows` destination (ERLI reusing Allegro's mappings). The projection
   * service filters the result by source connection + category in memory.
   */
  getAttributeMappingsByProvenance(
    destinationTaxonomyProvenance: string
  ): Promise<AttributeMapping[]>;
  upsertAttributeMapping(
    destinationConnectionId: string,
    input: AttributeMappingInput
  ): Promise<AttributeMapping>;
  deleteAttributeMapping(id: string): Promise<void>;
}
