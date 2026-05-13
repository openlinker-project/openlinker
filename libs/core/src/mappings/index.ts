/**
 * Mappings Bounded Context — Public API
 *
 * Exports everything needed by the API layer and other consumers
 * of the mappings module.
 *
 * @module libs/core/src/mappings
 */

export { MappingsModule } from './mappings.module';
export * from './mappings.tokens';
export type { IMappingConfigService } from './application/interfaces/mapping-config.service.interface';
export { MappingConfigService } from './application/services/mapping-config.service';
export { StatusMapping } from './domain/entities/status-mapping.entity';
export { CarrierMapping } from './domain/entities/carrier-mapping.entity';
export { PaymentMapping } from './domain/entities/payment-mapping.entity';
export { CategoryMapping } from './domain/entities/category-mapping.entity';
export type {
  StatusMappingInput,
  CarrierMappingInput,
  PaymentMappingInput,
  CategoryMappingInput,
} from './domain/types/mapping.types';
