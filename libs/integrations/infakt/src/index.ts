export { createInfaktPlugin, infaktAdapterManifest } from './infakt-plugin';

// Host wiring — createNestAdapterModule bridge (#1280).
export { InfaktIntegrationModule } from './infakt-integration.module';

export { InfaktWebhookTranslator } from './infrastructure/webhooks/infakt-webhook-translator';
export type { InfaktWebhookEvent, InfaktWebhookEventName, InfaktWebhookTranslatorConfig } from './infrastructure/webhooks/infakt-webhook-translator';
export { InfaktInvoicingAdapter, INFAKT_PROVIDER_TYPE } from './infrastructure/adapters/infakt-invoicing.adapter';
export { InfaktHttpClient, INFAKT_DEFAULT_BASE_URL } from './infrastructure/http/infakt-http-client';
export { InfaktApiError } from './domain/exceptions/infakt-api.error';
export type { InfaktInvoice, InfaktClient, InfaktKsefData, InfaktKsefStatus } from './domain/types/infakt.types';

// Shape validators + retry classifier — exported so host-side tests can
// register the real adapters (mirrors the KSeF precedent).
export { InfaktConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/infakt-connection-config-shape-validator.adapter';
export { InfaktConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/infakt-connection-credentials-shape-validator.adapter';
export { InfaktRetryClassifierAdapter } from './infrastructure/adapters/infakt-retry-classifier.adapter';
