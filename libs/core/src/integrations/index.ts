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
export { WebhookProvisioningRegistryService } from './infrastructure/adapters/webhook-provisioning-registry.service';
export { EmailNormalizerRegistryService } from './infrastructure/adapters/email-normalizer-registry.service';
export { ConnectionConfigShapeValidatorRegistryService } from './infrastructure/adapters/connection-config-shape-validator-registry.service';
export { ConnectionCredentialsShapeValidatorRegistryService } from './infrastructure/adapters/connection-credentials-shape-validator-registry.service';

// Ports
export { AdapterRegistryPort } from './domain/ports/adapter-registry.port';
export { CredentialsResolverPort } from './domain/ports/credentials-resolver.port';
export { AdapterFactoryPort } from './domain/ports/adapter-factory.port';
export { ConnectionTesterPort } from './domain/ports/connection-tester.port';
export { WebhookProvisioningPort } from './domain/ports/webhook-provisioning.port';
export { EmailNormalizerPort } from './domain/ports/email-normalizer.port';
export { ConnectionConfigShapeValidatorPort } from './domain/ports/connection-config-shape-validator.port';
export { ConnectionCredentialsShapeValidatorPort } from './domain/ports/connection-credentials-shape-validator.port';
export { WebhookSecretProviderPort, webhookSecretRef } from './domain/ports/webhook-secret-provider.port';
export {
  IntegrationCredentialRepositoryPort,
  CredentialCreate,
  CredentialUpdate,
} from './domain/ports/integration-credential-repository.port';

// Types
export {
  CoreCapability,
  CoreCapabilityValues,
  AdapterMetadata,
} from './domain/types/adapter.types';
export { ConnectionTestResult } from './domain/types/connection-test.types';
export { WebhookProvisioningResult } from './domain/types/webhook-provisioning.types';
export { MarketplaceCursor } from './domain/types/marketplace-cursor.types';

// Domain Entities
export { IntegrationCredential } from './domain/entities/integration-credential.entity';

// Exceptions
export { AdapterNotFoundException } from './domain/exceptions/adapter-not-found.exception';
export { CapabilityNotSupportedException } from './domain/exceptions/capability-not-supported.exception';
export { CapabilityNotEnabledException } from './domain/exceptions/capability-not-enabled.exception';
export { CredentialNotFoundException } from './domain/exceptions/credential-not-found.exception';
export { DuplicateAdapterKeyException } from './domain/exceptions/duplicate-adapter-key.exception';
export { DuplicatePlatformDefaultException } from './domain/exceptions/duplicate-platform-default.exception';
export { InvalidConnectionConfigException } from './domain/exceptions/invalid-connection-config.exception';
export { InvalidCredentialsShapeException } from './domain/exceptions/invalid-credentials-shape.exception';
export {
  flattenValidationErrors,
  ValidationErrorLike,
  FlatValidationIssue,
} from './application/util/flatten-validation-errors';

// ORM entities are exposed on the host-only `@openlinker/core/integrations/orm-entities`
// sub-path (#594). Plugins must not import them from here.

// Webhook secret
export { WebhookSecretService } from './application/services/webhook-secret.service';
export {
  IWebhookSecretService,
  RotateWebhookSecretResult,
} from './application/interfaces/webhook-secret.service.interface';
export { CredentialsWebhookSecretAdapter } from './infrastructure/adapters/credentials-webhook-secret.adapter';

// Tokens
export * from './integrations.tokens';

// Module
export { IntegrationsModule } from './integrations.module';

// Plugin Registry
export { PluginRegistryModule } from './plugin-registry.module';
export { PluginEntry, PluginRegistryOptions } from './plugin-registry.types';

