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
export { ConnectionTesterRegistryService } from './infrastructure/adapters/connection-tester-registry.service';

// Ports
export { AdapterRegistryPort } from './domain/ports/adapter-registry.port';
export { CredentialsResolverPort } from './domain/ports/credentials-resolver.port';
export { AdapterFactoryPort } from './domain/ports/adapter-factory.port';
export { ConnectionTesterPort } from './domain/ports/connection-tester.port';
export { WebhookSecretProviderPort, webhookSecretRef } from './domain/ports/webhook-secret-provider.port';
export { MarketplacePort } from './domain/ports/marketplace.port';
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
export { ConnectionTestResult } from './domain/types/connection-test.types';
export { MarketplaceCursor } from './domain/types/marketplace-cursor.types';
export {
  MarketplaceOrderEventTypeValues,
  MarketplaceOrderEventType,
  MarketplaceOrderFeedInput,
  MarketplaceOrderFeedOutput,
} from './domain/types/marketplace-order-feed.types';
export {
  MarketplaceOfferFeedInput,
  MarketplaceOfferFeedItem,
  MarketplaceOfferFeedOutput,
} from './domain/types/marketplace-offer-feed.types';
export {
  UpdateOfferQuantityCommand,
  UpdateOfferQuantitiesBatchCommand,
  UpdateOfferQuantitiesBatchResult,
  UpdateOfferQuantitiesBatchFailure,
} from './domain/types/marketplace-quantity-update.types';
export type { UpdateOfferFieldsCommand } from './domain/types/marketplace-offer-update.types';
export type { MarketplaceCategory } from './domain/types/marketplace-category.types';
export { CreateOfferResultStatusValues } from './domain/types/marketplace-offer-create.types';
export type {
  CreateOfferCommand,
  CreateOfferOverrides,
  CreateOfferResult,
  CreateOfferResultStatus,
} from './domain/types/marketplace-offer-create.types';

// Exceptions
export { AdapterNotFoundException } from './domain/exceptions/adapter-not-found.exception';
export { CapabilityNotSupportedException } from './domain/exceptions/capability-not-supported.exception';
export { CapabilityNotEnabledException } from './domain/exceptions/capability-not-enabled.exception';
export { CredentialNotFoundException } from './domain/exceptions/credential-not-found.exception';

// Webhook secret
export { WebhookSecretService } from './application/services/webhook-secret.service';
export {
  IWebhookSecretService,
  RotateWebhookSecretResult,
} from './application/interfaces/webhook-secret.service.interface';
export { CredentialsWebhookSecretAdapter } from './infrastructure/adapters/credentials-webhook-secret.adapter';

// Tokens
export {
  ADAPTER_REGISTRY_TOKEN,
  INTEGRATIONS_SERVICE_TOKEN,
  CREDENTIALS_RESOLVER_TOKEN,
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  CONNECTION_TESTER_REGISTRY_TOKEN,
  WEBHOOK_SECRET_PROVIDER_TOKEN,
  WEBHOOK_SECRET_SERVICE_TOKEN,
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
} from './integrations.tokens';

// Module
export { IntegrationsModule } from './integrations.module';

