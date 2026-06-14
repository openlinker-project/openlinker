/**
 * @openlinker/integrations-erli — Public Barrel
 *
 * Erli Shop API v1 adapter plugin (skeleton — #980). The runtime entry the
 * host composes is `ErliIntegrationModule`; this barrel also exports the
 * static `erliAdapterManifest` (#575 pattern) and the plugin factory.
 * Capability adapters, HTTP client, and connection validators land in the
 * follow-up Erli issues (#981–#998); see ADR-025 for the architecture
 * decisions they build on.
 *
 * @module libs/integrations/erli/src
 */

// Plugin descriptor + static manifest (#575)
export { erliAdapterManifest, createErliPlugin } from './erli-plugin';

// Host wiring
export { ErliIntegrationModule } from './erli-integration.module';

// HTTP-client domain exceptions (#981). The client + interface stay
// package-private (siblings keep theirs private too); these typed exceptions
// are the public surface — they feed the host RetryClassifier /
// AuthFailureClassifier the Erli adapters register in #984/#993 (ADR-008).
export { ErliApiException } from './domain/exceptions/erli-api.exception';
export { ErliAuthenticationException } from './domain/exceptions/erli-authentication.exception';
export { ErliRateLimitException } from './domain/exceptions/erli-rate-limit.exception';
export { ErliNetworkException } from './domain/exceptions/erli-network.exception';
