/**
 * Mappings Module DI Tokens
 *
 * Symbol tokens for dependency injection in the mappings module.
 *
 * @module libs/core/src/mappings
 */

export const MAPPING_CONFIG_SERVICE_TOKEN = Symbol('IMappingConfigService');
export const STATUS_MAPPING_REPOSITORY_TOKEN = Symbol('StatusMappingRepositoryPort');
export const CARRIER_MAPPING_REPOSITORY_TOKEN = Symbol('CarrierMappingRepositoryPort');
export const PAYMENT_MAPPING_REPOSITORY_TOKEN = Symbol('PaymentMappingRepositoryPort');
