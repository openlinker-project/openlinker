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
export const WEBHOOK_SECRET_SERVICE_TOKEN = Symbol('IWebhookSecretService');
export const INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN = Symbol('IntegrationCredentialRepositoryPort');
export const CREDENTIALS_SERVICE_TOKEN = Symbol('ICredentialsService');
export const CONNECTION_TESTER_REGISTRY_TOKEN = Symbol('ConnectionTesterRegistryService');
export const WEBHOOK_PROVISIONING_REGISTRY_TOKEN = Symbol('WebhookProvisioningRegistryService');
export const WEBHOOK_EVENT_TRANSLATOR_REGISTRY_TOKEN = Symbol(
  'WebhookEventTranslatorRegistryService',
);
export const INBOUND_WEBHOOK_DECODER_REGISTRY_TOKEN = Symbol(
  'InboundWebhookDecoderRegistryService',
);
export const PLUGIN_REGISTRY_OPTIONS_TOKEN = Symbol('PluginRegistryOptions');
export const EMAIL_NORMALIZER_REGISTRY_TOKEN = Symbol('EmailNormalizerRegistryService');
export const CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN = Symbol(
  'ConnectionConfigShapeValidatorRegistryService',
);
export const CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN = Symbol(
  'ConnectionCredentialsShapeValidatorRegistryService',
);
export const INTEGRATIONS_OAUTH_COMPLETION_REGISTRY_TOKEN = Symbol(
  'OAuthCompletionRegistryService',
);
export const CONNECTION_CREDENTIALS_REWRITER_REGISTRY_TOKEN = Symbol(
  'ConnectionCredentialsRewriterRegistryService',
);

