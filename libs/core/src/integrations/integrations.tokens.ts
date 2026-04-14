/**
 * Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the integrations module.
 * These tokens are used to inject interfaces (which can't be used as values)
 * into services and other providers.
 *
 * @module libs/core/src/integrations
 */

// Token for dependency injection (interfaces can't be used as values)
export const ADAPTER_REGISTRY_TOKEN = Symbol('AdapterRegistryPort');
export const INTEGRATIONS_SERVICE_TOKEN = Symbol('IIntegrationsService');
export const CREDENTIALS_RESOLVER_TOKEN = Symbol('CredentialsResolverPort');
export const ADAPTER_FACTORY_RESOLVER_TOKEN = Symbol('AdapterFactoryResolverService');
export const WEBHOOK_SECRET_PROVIDER_TOKEN = Symbol('WebhookSecretProviderPort');
export const INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN = Symbol('IntegrationCredentialRepositoryPort');
export const CONNECTION_TESTER_REGISTRY_TOKEN = Symbol('ConnectionTesterRegistryService');

