export { createInfaktPlugin, infaktAdapterManifest } from './infakt-plugin';

// Host wiring — createNestAdapterModule bridge (#1280).
export { InfaktIntegrationModule } from './infakt-integration.module';

export { InfaktWebhookTranslator } from './infrastructure/webhooks/infakt-webhook-translator';
export type { InfaktWebhookEvent, InfaktWebhookEventName, InfaktWebhookTranslatorConfig } from './infrastructure/webhooks/infakt-webhook-translator';
export { InfaktInvoicingAdapter, INFAKT_PROVIDER_TYPE } from './infrastructure/adapters/infakt-invoicing.adapter';
export { InfaktHttpClient } from './infrastructure/http/infakt-http-client';
export {
  INFAKT_DEFAULT_BASE_URL,
  INFAKT_SANDBOX_BASE_URL,
} from './domain/policies/infakt-base-url.policy';
export { InfaktApiError } from './domain/exceptions/infakt-api.error';
export { InfaktConfigException } from './domain/exceptions/infakt-config.exception';
export type { InfaktInvoice, InfaktClient, InfaktKsefData, InfaktKsefStatus } from './domain/types/infakt.types';
export { InfaktEnvironmentValues } from './domain/types/infakt-connection.types';
export type { InfaktEnvironment } from './domain/types/infakt-connection.types';

// Shape validators + retry classifier — exported so host-side tests can
// register the real adapters (mirrors the KSeF precedent).
export { InfaktConnectionConfigShapeValidatorAdapter } from './infrastructure/adapters/infakt-connection-config-shape-validator.adapter';
export { InfaktConnectionCredentialsShapeValidatorAdapter } from './infrastructure/adapters/infakt-connection-credentials-shape-validator.adapter';
export { InfaktRetryClassifierAdapter } from './infrastructure/adapters/infakt-retry-classifier.adapter';

// Webhook ingress (#1281, ADR-021/ADR-015) — exported so host-side tests can
// register the real adapters.
export { InfaktInboundWebhookDecoderAdapter } from './infrastructure/adapters/infakt-inbound-webhook-decoder.adapter';
export { InfaktWebhookEventTranslatorAdapter } from './infrastructure/adapters/infakt-webhook-event-translator.adapter';
