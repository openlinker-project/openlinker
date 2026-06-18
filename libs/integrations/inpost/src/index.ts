/**
 * @openlinker/integrations-inpost — Public Barrel
 *
 * InPost ShipX shipping adapter plugin. The runtime entry the host composes is
 * `inpostIntegrationModule` (added with the plugin descriptor); this barrel
 * also exports the static `inpostAdapterManifest` and the domain exceptions
 * for host-side error handling.
 *
 * @module libs/integrations/inpost/src
 */

// Domain exceptions
export { InpostConfigException } from './domain/exceptions/inpost-config.exception';
export { InpostUnauthorizedException } from './domain/exceptions/inpost-unauthorized.exception';
export { InpostNetworkException } from './domain/exceptions/inpost-network.exception';
// Validation / paczkomat-unavailable rejections now throw the shared
// `ShippingProviderRejectionException` from `@openlinker/core/shipping`
// (#885) — `providerName: 'inpost'`, `providerCode: 'target_point'` /
// `'preflight.*'`, structured details on `providerDetails`.

// Config + credentials types
export { InpostEnvironmentValues } from './domain/types/inpost-config.types';
export type {
  InpostEnvironment,
  InpostConnectionConfig,
  InpostSenderContact,
} from './domain/types/inpost-config.types';
export type { InpostCredentials } from './domain/types/inpost-credentials.types';

// Auth-failure classifier (#819 / #1103) — exported for host-side discovery;
// the plugin self-registers it against `host.authFailureClassifierRegistry`.
export { InpostAuthFailureClassifierAdapter } from './infrastructure/adapters/inpost-auth-failure-classifier.adapter';

// Plugin descriptor + host wiring
export { inpostAdapterManifest, createInpostPlugin } from './inpost-plugin';
export { InpostIntegrationModule } from './inpost-integration.module';
