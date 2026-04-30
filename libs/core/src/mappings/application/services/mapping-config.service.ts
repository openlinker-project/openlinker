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
import { IMappingConfigService } from '../interfaces/mapping-config.service.interface';
import { StatusMapping } from '../../domain/entities/status-mapping.entity';
import { CarrierMapping } from '../../domain/entities/carrier-mapping.entity';
import { PaymentMapping } from '../../domain/entities/payment-mapping.entity';
import { CategoryMapping } from '../../domain/entities/category-mapping.entity';
import {
  StatusMappingInput,
  CarrierMappingInput,
  PaymentMappingInput,
  CategoryMappingInput,
} from '../../domain/types/mapping.types';
import { StatusMappingRepositoryPort } from '../../domain/ports/status-mapping-repository.port';
import { CarrierMappingRepositoryPort } from '../../domain/ports/carrier-mapping-repository.port';
import { PaymentMappingRepositoryPort } from '../../domain/ports/payment-mapping-repository.port';
import { CategoryMappingRepositoryPort } from '../../domain/ports/category-mapping-repository.port';
import {
  STATUS_MAPPING_REPOSITORY_TOKEN,
  CARRIER_MAPPING_REPOSITORY_TOKEN,
  PAYMENT_MAPPING_REPOSITORY_TOKEN,
  CATEGORY_MAPPING_REPOSITORY_TOKEN,
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
  ) {}

  getStatusMappings(connectionId: string): Promise<StatusMapping[]> {
    return this.statusRepo.findByConnectionId(connectionId);
  }

  upsertStatusMappings(connectionId: string, items: StatusMappingInput[]): Promise<StatusMapping[]> {
    return this.statusRepo.replaceForConnection(connectionId, items);
  }

  getCarrierMappings(connectionId: string): Promise<CarrierMapping[]> {
    return this.carrierRepo.findByConnectionId(connectionId);
  }

  upsertCarrierMappings(connectionId: string, items: CarrierMappingInput[]): Promise<CarrierMapping[]> {
    return this.carrierRepo.replaceForConnection(connectionId, items);
  }

  getPaymentMappings(connectionId: string): Promise<PaymentMapping[]> {
    return this.paymentRepo.findByConnectionId(connectionId);
  }

  upsertPaymentMappings(connectionId: string, items: PaymentMappingInput[]): Promise<PaymentMapping[]> {
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
    allegroDeliveryMethodId: string,
  ): Promise<string | null> {
    // TODO: cache per sync session — same N+1 concern as resolveStatusMapping.
    const mappings = await this.carrierRepo.findByConnectionId(connectionId);
    const match = mappings.find((m) => m.allegroDeliveryMethodId === allegroDeliveryMethodId);
    return match?.prestashopCarrierId ?? null;
  }

  getCategoryMappings(connectionId: string): Promise<CategoryMapping[]> {
    return this.categoryRepo.findByConnectionId(connectionId);
  }

  upsertCategoryMapping(connectionId: string, input: CategoryMappingInput): Promise<CategoryMapping> {
    return this.categoryRepo.upsertMapping(connectionId, input);
  }

  deleteCategoryMapping(connectionId: string, prestashopCategoryId: string): Promise<void> {
    return this.categoryRepo.deleteMapping(connectionId, prestashopCategoryId);
  }

  async resolveAllegroCategory(connectionId: string, prestashopCategoryId: string): Promise<string | null> {
    const mapping = await this.categoryRepo.findByPrestashopCategoryId(connectionId, prestashopCategoryId);
    return mapping?.allegroCategoryId ?? null;
  }
}
