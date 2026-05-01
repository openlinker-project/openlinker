/**
 * Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the customers module.
 * These tokens are used to inject interfaces (which can't be used as values)
 * into services and other providers.
 *
 * @module libs/core/src/customers
 */

// Token for dependency injection (interfaces can't be used as values)
export const CUSTOMER_PROJECTION_REPOSITORY_TOKEN = Symbol('CustomerProjectionRepositoryPort');
export const CUSTOMER_PROJECTION_SERVICE_TOKEN = Symbol('ICustomerProjectionService');
export const CUSTOMER_IDENTITY_RESOLVER_SERVICE_TOKEN = Symbol('ICustomerIdentityResolverService');
export const CUSTOMER_IDENTITY_RESOLVER_PORT_TOKEN = Symbol('CustomerIdentityResolverPort');
export const ORDER_CUSTOMER_PROJECTION_UPDATER_SERVICE_TOKEN = Symbol(
  'IOrderCustomerProjectionUpdaterService',
);
