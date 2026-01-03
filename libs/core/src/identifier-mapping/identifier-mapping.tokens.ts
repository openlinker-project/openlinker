/**
 * Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the identifier mapping module.
 * These tokens are used to inject interfaces (which can't be used as values)
 * into services and other providers.
 *
 * @module libs/core/src/identifier-mapping
 */

// Token for dependency injection (interfaces can't be used as values)
export const IDENTIFIER_MAPPING_SERVICE_TOKEN = Symbol('IIdentifierMappingService');
export const IDENTIFIER_MAPPING_PORT_TOKEN = Symbol('IdentifierMappingPort');
export const IDENTIFIER_MAPPING_REPOSITORY_TOKEN = Symbol('IdentifierMappingRepositoryPort');
export const CONNECTION_PORT_TOKEN = Symbol('ConnectionPort');





