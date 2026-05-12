/**
 * Integrations Module
 *
 * NestJS module for integrations functionality. Configures adapter registry,
 * integrations service, and dependency injection. Exports services and ports
 * for use in other modules (API, Worker).
 *
 * @module libs/core/src/integrations
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentifierMappingModule } from '../identifier-mapping/identifier-mapping.module';
import { AdapterRegistryService } from './infrastructure/adapters/adapter-registry.service';
import { IntegrationsService } from './application/services/integrations.service';
import { CredentialsResolverService } from './infrastructure/credentials/credentials-resolver.service';
import { AdapterFactoryResolverService } from './infrastructure/adapters/adapter-factory-resolver.service';
import { ConnectionTesterRegistryService } from './infrastructure/adapters/connection-tester-registry.service';
import { WebhookProvisioningRegistryService } from './infrastructure/adapters/webhook-provisioning-registry.service';
import { EmailNormalizerRegistryService } from './infrastructure/adapters/email-normalizer-registry.service';
import { ConnectionConfigShapeValidatorRegistryService } from './infrastructure/adapters/connection-config-shape-validator-registry.service';
import { ConnectionCredentialsShapeValidatorRegistryService } from './infrastructure/adapters/connection-credentials-shape-validator-registry.service';
import { CredentialsWebhookSecretAdapter } from './infrastructure/adapters/credentials-webhook-secret.adapter';
import { WebhookSecretService } from './application/services/webhook-secret.service';
import { CryptoService } from '@openlinker/shared';
import { IntegrationCredentialOrmEntity } from './infrastructure/persistence/entities/integration-credential.orm-entity';
import { IntegrationCredentialRepository } from './infrastructure/persistence/repositories/integration-credential.repository';
import {
  ADAPTER_REGISTRY_TOKEN,
  INTEGRATIONS_SERVICE_TOKEN,
  CREDENTIALS_RESOLVER_TOKEN,
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  WEBHOOK_SECRET_PROVIDER_TOKEN,
  WEBHOOK_SECRET_SERVICE_TOKEN,
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
  CONNECTION_TESTER_REGISTRY_TOKEN,
  WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
  EMAIL_NORMALIZER_REGISTRY_TOKEN,
  CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN,
} from './integrations.tokens';

// Re-export tokens for convenience
export {
  ADAPTER_REGISTRY_TOKEN,
  INTEGRATIONS_SERVICE_TOKEN,
  CREDENTIALS_RESOLVER_TOKEN,
  ADAPTER_FACTORY_RESOLVER_TOKEN,
  WEBHOOK_SECRET_PROVIDER_TOKEN,
  WEBHOOK_SECRET_SERVICE_TOKEN,
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
  CONNECTION_TESTER_REGISTRY_TOKEN,
  WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
  EMAIL_NORMALIZER_REGISTRY_TOKEN,
  CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN,
} from './integrations.tokens';

@Module({
  imports: [
    IdentifierMappingModule, // For ConnectionPort
    ConfigModule,
    TypeOrmModule.forFeature([IntegrationCredentialOrmEntity]),
  ],
  providers: [
    AdapterRegistryService,
    IntegrationsService,
    CredentialsResolverService,
    AdapterFactoryResolverService,
    ConnectionTesterRegistryService,
    WebhookProvisioningRegistryService,
    EmailNormalizerRegistryService,
    ConnectionConfigShapeValidatorRegistryService,
    ConnectionCredentialsShapeValidatorRegistryService,
    CredentialsWebhookSecretAdapter,
    WebhookSecretService,
    CryptoService,
    IntegrationCredentialRepository,
    {
      provide: ADAPTER_REGISTRY_TOKEN,
      useExisting: AdapterRegistryService,
    },
    {
      provide: INTEGRATIONS_SERVICE_TOKEN,
      useExisting: IntegrationsService,
    },
    {
      provide: CREDENTIALS_RESOLVER_TOKEN,
      useExisting: CredentialsResolverService,
    },
    {
      provide: ADAPTER_FACTORY_RESOLVER_TOKEN,
      useExisting: AdapterFactoryResolverService,
    },
    {
      provide: CONNECTION_TESTER_REGISTRY_TOKEN,
      useExisting: ConnectionTesterRegistryService,
    },
    {
      provide: WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
      useExisting: WebhookProvisioningRegistryService,
    },
    {
      provide: EMAIL_NORMALIZER_REGISTRY_TOKEN,
      useExisting: EmailNormalizerRegistryService,
    },
    {
      provide: CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN,
      useExisting: ConnectionConfigShapeValidatorRegistryService,
    },
    {
      provide: CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN,
      useExisting: ConnectionCredentialsShapeValidatorRegistryService,
    },
    {
      provide: WEBHOOK_SECRET_PROVIDER_TOKEN,
      useExisting: CredentialsWebhookSecretAdapter,
    },
    {
      provide: WEBHOOK_SECRET_SERVICE_TOKEN,
      useExisting: WebhookSecretService,
    },
    {
      provide: INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
      useExisting: IntegrationCredentialRepository,
    },
  ],
  exports: [
    ADAPTER_REGISTRY_TOKEN,
    INTEGRATIONS_SERVICE_TOKEN,
    CREDENTIALS_RESOLVER_TOKEN,
    ADAPTER_FACTORY_RESOLVER_TOKEN,
    CONNECTION_TESTER_REGISTRY_TOKEN,
    WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
    EMAIL_NORMALIZER_REGISTRY_TOKEN,
    CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN,
    CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN,
    WEBHOOK_SECRET_PROVIDER_TOKEN,
    WEBHOOK_SECRET_SERVICE_TOKEN,
    INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
    IntegrationsService,
    CredentialsResolverService,
    AdapterFactoryResolverService,
    ConnectionTesterRegistryService,
    WebhookProvisioningRegistryService,
    EmailNormalizerRegistryService,
    ConnectionConfigShapeValidatorRegistryService,
    ConnectionCredentialsShapeValidatorRegistryService,
    WebhookSecretService,
  ],
})
export class IntegrationsModule {}

