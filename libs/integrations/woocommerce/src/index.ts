/**
 * @openlinker/integrations-woocommerce — Public Barrel
 *
 * WooCommerce REST API v3 adapter plugin. The runtime entry the host
 * composes is `WooCommerceIntegrationModule`; this barrel also exports the
 * static `woocommerceAdapterManifest` and the config / credentials types so
 * capability adapters in #874+ can import via the barrel rather than deep
 * paths.
 *
 * No domain exceptions are exported at scaffold stage — typed exceptions
 * (`WooCommerceUnauthorizedException`, etc.) are added in #874 alongside the
 * full HTTP client retry loop.
 *
 * @module libs/integrations/woocommerce/src
 */

// Config + credentials types
export type { WooCommerceConnectionConfig } from './domain/types/woocommerce-config.types';
export type { WooCommerceCredentials } from './domain/types/woocommerce-credentials.types';

// Plugin descriptor + static manifest (#575)
export { woocommerceAdapterManifest, createWooCommercePlugin } from './woocommerce-plugin';

// Host wiring
export { WooCommerceIntegrationModule } from './woocommerce-integration.module';
