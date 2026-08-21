/**
 * Mapping Config Service
 *
 * Application service for connection-scoped mapping configuration.
 * Delegates persistence to repository ports and provides a resolution
 * helper for use during order ingestion.
 *
 * @module libs/core/src/mappings/application/services
 * @implements {IMappingConfigService}
 */

import { Injectable, Inject } from '@nestjs/common';
import type { OrderStatus } from '@openlinker/core/orders';
import type { IMappingConfigService } from '../interfaces/mapping-config.service.interface';
import type { StatusMapping } from '../../domain/entities/status-mapping.entity';
import type { CarrierMapping } from '../../domain/entities/carrier-mapping.entity';
import type { PaymentMapping } from '../../domain/entities/payment-mapping.entity';
import type { CategoryMapping } from '../../domain/entities/category-mapping.entity';
import type { OrderStateMapping } from '../../domain/entities/order-state-mapping.entity';
import type { AttributeMapping } from '../../domain/entities/attribute-mapping.entity';
import type { AttributeMappingRule } from '../../domain/entities/attribute-mapping-rule.entity';
import type {
  StatusMappingInput,
  CarrierMappingInput,
  PaymentMappingInput,
  CategoryMappingInput,
  OrderStateMappingInput,
  AttributeMappingInput,
} from '../../domain/types/mapping.types';
import type { AttributeMappingRuleInput } from '../../domain/types/attribute-mapping-rule.types';
import { StatusMappingRepositoryPort } from '../../domain/ports/status-mapping-repository.port';
import { CarrierMappingRepositoryPort } from '../../domain/ports/carrier-mapping-repository.port';
import { PaymentMappingRepositoryPort } from '../../domain/ports/payment-mapping-repository.port';
import { CategoryMappingRepositoryPort } from '../../domain/ports/category-mapping-repository.port';
import { OrderStateMappingRepositoryPort } from '../../domain/ports/order-state-mapping-repository.port';
import { AttributeMappingRepositoryPort } from '../../domain/ports/attribute-mapping-repository.port';
import { AttributeMappingRuleRepositoryPort } from '../../domain/ports/attribute-mapping-rule-repository.port';
import {
  STATUS_MAPPING_REPOSITORY_TOKEN,
  CARRIER_MAPPING_REPOSITORY_TOKEN,
  PAYMENT_MAPPING_REPOSITORY_TOKEN,
  CATEGORY_MAPPING_REPOSITORY_TOKEN,
  ORDER_STATE_MAPPING_REPOSITORY_TOKEN,
  ATTRIBUTE_MAPPING_REPOSITORY_TOKEN,
  ATTRIBUTE_MAPPING_RULE_REPOSITORY_TOKEN,
} from '../../mappings.tokens';

@Injectable()
export class MappingConfigService implements IMappingConfigService {
  constructor(
    @Inject(STATUS_MAPPING_REPOSITORY_TOKEN)
    private readonly statusRepo: StatusMappingRepositoryPort,
    @Inject(CARRIER_MAPPING_REPOSITORY_TOKEN)
    private readonly carrierRepo: CarrierMappingRepositoryPort,
    @Inject(PAYMENT_MAPPING_REPOSITORY_TOKEN)
    private readonly paymentRepo: PaymentMappingRepositoryPort,
    @Inject(CATEGORY_MAPPING_REPOSITORY_TOKEN)
    private readonly categoryRepo: CategoryMappingRepositoryPort,
    @Inject(ORDER_STATE_MAPPING_REPOSITORY_TOKEN)
    private readonly orderStateRepo: OrderStateMappingRepositoryPort,
    @Inject(ATTRIBUTE_MAPPING_REPOSITORY_TOKEN)
    private readonly attributeRepo: AttributeMappingRepositoryPort,
    @Inject(ATTRIBUTE_MAPPING_RULE_REPOSITORY_TOKEN)
    private readonly attributeRuleRepo: AttributeMappingRuleRepositoryPort
  ) {}

  getStatusMappings(connectionId: string): Promise<StatusMapping[]> {
    return this.statusRepo.findByConnectionId(connectionId);
  }

  upsertStatusMappings(
    connectionId: string,
    items: StatusMappingInput[]
  ): Promise<StatusMapping[]> {
    return this.statusRepo.replaceForConnection(connectionId, items);
  }

  getCarrierMappings(connectionId: string): Promise<CarrierMapping[]> {
    return this.carrierRepo.findByConnectionId(connectionId);
  }

  upsertCarrierMappings(
    connectionId: string,
    items: CarrierMappingInput[]
  ): Promise<CarrierMapping[]> {
    return this.carrierRepo.replaceForConnection(connectionId, items);
  }

  getPaymentMappings(connectionId: string): Promise<PaymentMapping[]> {
    return this.paymentRepo.findByConnectionId(connectionId);
  }

  upsertPaymentMappings(
    connectionId: string,
    items: PaymentMappingInput[]
  ): Promise<PaymentMapping[]> {
    return this.paymentRepo.replaceForConnection(connectionId, items);
  }

  async resolveStatusMapping(connectionId: string, allegroStatus: string): Promise<string | null> {
    // TODO: cache per sync session to avoid N+1 queries when resolving status for every order.
    // Acceptable for MVP; a session-scoped Map<connectionId, StatusMapping[]> would eliminate the per-order DB fetch.
    const mappings = await this.statusRepo.findByConnectionId(connectionId);
    const match = mappings.find((m) => m.allegroStatus === allegroStatus);
    return match?.prestashopStatusId ?? null;
  }

  async resolveCarrierMapping(
    connectionId: string,
    allegroDeliveryMethodId: string
  ): Promise<string | null> {
    // TODO: cache per sync session — same N+1 concern as resolveStatusMapping.
    const mappings = await this.carrierRepo.findByConnectionId(connectionId);
    const match = mappings.find((m) => m.allegroDeliveryMethodId === allegroDeliveryMethodId);
    return match?.prestashopCarrierId ?? null;
  }

  getOrderStateMappings(connectionId: string): Promise<OrderStateMapping[]> {
    return this.orderStateRepo.findByConnectionId(connectionId);
  }

  upsertOrderStateMappings(
    connectionId: string,
    items: OrderStateMappingInput[]
  ): Promise<OrderStateMapping[]> {
    return this.orderStateRepo.replaceForConnection(connectionId, items);
  }

  async resolveOrderStateMapping(
    connectionId: string,
    olStatus: OrderStatus
  ): Promise<string | null> {
    // `connectionId` is the DESTINATION connection (#862). Returns null when no
    // override is configured; the adapter falls back to its hardcoded map.
    const mappings = await this.orderStateRepo.findByConnectionId(connectionId);
    const match = mappings.find((m) => m.olStatus === olStatus);
    return match?.externalStateId ?? null;
  }

  getCategoryMappings(destinationConnectionId: string): Promise<CategoryMapping[]> {
    return this.categoryRepo.findByDestinationConnection(destinationConnectionId);
  }

  upsertCategoryMapping(
    destinationConnectionId: string,
    input: CategoryMappingInput
  ): Promise<CategoryMapping> {
    return this.categoryRepo.upsertMapping(destinationConnectionId, input);
  }

  deleteCategoryMapping(destinationConnectionId: string, sourceCategoryId: string): Promise<void> {
    return this.categoryRepo.deleteMapping(destinationConnectionId, sourceCategoryId);
  }

  async resolveDestinationCategory(
    destinationConnectionId: string,
    sourceCategoryId: string,
    opts?: { borrowedTaxonomy?: string; sourceConnectionId?: string }
  ): Promise<string | null> {
    // 1. Destination-keyed row wins — an explicit mapping authored for this exact
    //    connection overrides any borrowed reuse.
    const direct = await this.categoryRepo.findBySourceCategory(
      destinationConnectionId,
      sourceCategoryId
    );
    if (direct) {
      return direct.destinationCategoryId;
    }
    // 2. Borrowed-taxonomy fallback (#1045): a `borrows` destination reuses an
    //    owner-authored row under its borrowed provenance, source-scoped when known.
    if (opts?.borrowedTaxonomy) {
      for (const provenance of this.provenanceCandidates(opts.borrowedTaxonomy)) {
        const reused = await this.categoryRepo.findBySourceCategoryByProvenance(
          provenance,
          sourceCategoryId,
          opts.sourceConnectionId ?? null
        );
        if (reused) {
          return reused.destinationCategoryId;
        }
      }
      return null;
    }
    return null;
  }

  /**
   * Provenance values to try for a borrowed taxonomy, most specific first.
   *
   * Nothing in this store ever PERSISTS a qualified provenance: every writer
   * goes through the repositories' `?? 'allegro'` default, so an operator's
   * Allegro-authored rows carry the bare owner regardless of which environment
   * the connection points at. A borrowing destination, on the other hand, names
   * the owner whose TREE it consumes, and that value is environment-qualified
   * (`'allegro:sandbox'`, #2063/#2210) precisely because sandbox and production
   * publish different trees. Trying the qualified value first and then the bare
   * owner keeps both true: a future qualified row wins where it exists, and a
   * sandbox destination still reuses the mappings the operator already authored
   * instead of silently resolving nothing.
   */
  private provenanceCandidates(borrowedTaxonomy: string): string[] {
    const separator = borrowedTaxonomy.indexOf(':');
    if (separator <= 0) {
      return [borrowedTaxonomy];
    }
    return [borrowedTaxonomy, borrowedTaxonomy.slice(0, separator)];
  }

  getAttributeMappings(destinationConnectionId: string): Promise<AttributeMapping[]> {
    return this.attributeRepo.findByDestinationConnection(destinationConnectionId);
  }

  async getAttributeMappingsByProvenance(
    destinationTaxonomyProvenance: string
  ): Promise<AttributeMapping[]> {
    // Same qualified-then-bare rule as the category read above, for the same
    // reason: the store persists only bare owner provenances today.
    for (const provenance of this.provenanceCandidates(destinationTaxonomyProvenance)) {
      const rows = await this.attributeRepo.findByProvenance(provenance);
      if (rows.length > 0) {
        return rows;
      }
    }
    return [];
  }

  upsertAttributeMapping(
    destinationConnectionId: string,
    input: AttributeMappingInput
  ): Promise<AttributeMapping> {
    return this.attributeRepo.upsertMapping(destinationConnectionId, input);
  }

  deleteAttributeMapping(id: string): Promise<void> {
    return this.attributeRepo.deleteMapping(id);
  }

  getAttributeMappingRules(destinationConnectionId: string): Promise<AttributeMappingRule[]> {
    return this.attributeRuleRepo.findByDestinationConnection(destinationConnectionId);
  }

  upsertAttributeMappingRule(
    destinationConnectionId: string,
    input: AttributeMappingRuleInput
  ): Promise<AttributeMappingRule> {
    return this.attributeRuleRepo.upsertRule(destinationConnectionId, input);
  }

  deleteAttributeMappingRule(id: string, destinationConnectionId: string): Promise<void> {
    return this.attributeRuleRepo.deleteRule(id, destinationConnectionId);
  }
}
