/**
 * @openlinker/integrations-erli — Public Barrel
 *
 * Erli Shop API v1 adapter plugin (skeleton — #980). The runtime entry the
 * host composes is `ErliIntegrationModule`; this barrel also exports the
 * static `erliAdapterManifest` (#575 pattern) and the plugin factory.
 * Capability adapters, HTTP client, and connection validators land in the
 * follow-up Erli issues (#981–#998); see ADR-022 for the architecture
 * decisions they build on.
 *
 * @module libs/integrations/erli/src
 */

// Plugin descriptor + static manifest (#575)
export { erliAdapterManifest, createErliPlugin } from './erli-plugin';

// Host wiring
export { ErliIntegrationModule } from './erli-integration.module';
