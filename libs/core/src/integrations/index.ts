/**
 * Integrations Module Exports
 *
 * Public API for the integrations module. Exports services, ports, types,
 * and tokens for use by other modules.
 *
 * @module libs/core/src/integrations
 */

// Services
export { IntegrationsService } from './application/services/integrations.service';
export { IIntegrationsService } from './application/interfaces/integrations.service.interface';
export { AdapterFactoryResolverService } from './infrastructure/adapters/adapter-factory-resolver.service';

// Ports
export { AdapterRegistryPort } from './domain/ports/adapter-registry.port';
export { CredentialsResolverPort } from './domain/ports/credentials-resolver.port';
export { AdapterFactoryPort } from './domain/ports/adapter-factory.port';
export { WebhookSecretProviderPort } from './domain/ports/webhook-secret-provider.port';
export {
  IntegrationCredentialRepositoryPort,
  CredentialCreate,
  CredentialUpdate,
} from './domain/ports/integration-credential-repository.port';

// Types
export {
  Capability,
  CapabilityValues,
  AdapterMetadata,
  AdapterInstance,
} from './domain/types/adapter.types';

// Exceptions
export { AdapterNotFoundException } from './domain/exceptions/adapter-not-found.exception';
export { CapabilityNotSupportedException } from './domain/exceptions/capability-not-supported.exception';
export { CredentialNotFoundException } from './domain/exceptions/credential-not-found.exception';

// Tokens
export {
  ADAPTER_REGISTRY_TOKEN,
  INTEGRATIONS_SERVICE_TOKEN,
  CREDENTIALS_RESOLVER_TOKEN,
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  WEBHOOK_SECRET_PROVIDER_TOKEN,
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
} from './integrations.tokens';

// Module
export { IntegrationsModule } from './integrations.module';

