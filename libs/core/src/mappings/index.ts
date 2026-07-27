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
export { OrderStateMapping } from './domain/entities/order-state-mapping.entity';
export { AttributeMapping } from './domain/entities/attribute-mapping.entity';
export { AttributeValueMapping } from './domain/entities/attribute-value-mapping.entity';
export type {
  StatusMappingInput,
  CarrierMappingInput,
  PaymentMappingInput,
  CategoryMappingInput,
  OrderStateMappingInput,
  AttributeMappingInput,
} from './domain/types/mapping.types';

// Fulfillment routing (#832)
export type { IFulfillmentRoutingService } from './application/interfaces/fulfillment-routing.service.interface';
export { FulfillmentRoutingRule } from './domain/entities/fulfillment-routing-rule.entity';
export { IncompatibleProcessorException } from './domain/exceptions/incompatible-processor.exception';
export { DuplicateRoutingRuleException } from './domain/exceptions/duplicate-routing-rule.exception';
export {
  FulfillmentProcessorKindValues,
  FULFILLMENT_PROCESSOR_KIND,
  FulfillmentRoutingSourceValues,
} from './domain/types/fulfillment-routing.types';
export type {
  FulfillmentProcessorKind,
  FulfillmentRoutingSource,
  FulfillmentRoutingRuleInput,
  FulfillmentRoutingQuery,
  FulfillmentRoutingResolution,
  CandidateProcessor,
} from './domain/types/fulfillment-routing.types';

// Delivery rider (#1792)
export type { IDeliveryRiderService } from './application/interfaces/delivery-rider.service.interface';
export { DeliveryRiderValues } from './domain/types/delivery-rider.types';
export type {
  DeliveryRider,
  RiderSourceDeliveryMethod,
  DeliveryRiderInput,
  CandidateCarrier,
  DeliveryRiderResolution,
} from './domain/types/delivery-rider.types';
