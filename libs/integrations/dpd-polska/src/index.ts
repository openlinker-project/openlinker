/**
 * @openlinker/integrations-dpd-polska — Public Barrel
 *
 * DPD Polska DPDServices REST shipping adapter plugin. The runtime entry the
 * host composes is `DpdIntegrationModule`; this barrel also exports the static
 * `dpdAdapterManifest` and the domain exceptions for host-side error handling.
 *
 * @module libs/integrations/dpd-polska/src
 */

// Domain exceptions
export { DpdConfigException } from './domain/exceptions/dpd-config.exception';
export { DpdUnauthorizedException } from './domain/exceptions/dpd-unauthorized.exception';
export { DpdNetworkException } from './domain/exceptions/dpd-network.exception';
// Per-shipment / command validation rejections throw the shared
// `ShippingProviderRejectionException` from `@openlinker/core/shipping`
// (#885) — `providerName: 'dpd'`, `providerCode` carries the DPD `errorCode`
// (or a `preflight.*` / `command.*` pseudo-code), structured details on
// `providerDetails`.

// Config + credentials types
export { DpdEnvironmentValues } from './domain/types/dpd-config.types';
export type {
  DpdEnvironment,
  DpdConnectionConfig,
  DpdSenderContact,
} from './domain/types/dpd-config.types';
export type { DpdCredentials } from './domain/types/dpd-credentials.types';

// Auth-failure classifier (#819 / #1103) — exported for host-side discovery;
// the plugin self-registers it against `host.authFailureClassifierRegistry`.
export { DpdAuthFailureClassifierAdapter } from './infrastructure/adapters/dpd-auth-failure-classifier.adapter';

// Plugin descriptor + host wiring
export { dpdAdapterManifest, createDpdPlugin } from './dpd-plugin';
export { DpdIntegrationModule } from './dpd-integration.module';
