/**
 * @openlinker/integrations-woocommerce — Public Barrel
 *
 * WooCommerce REST API v3 adapter plugin. The runtime entry the host
 * composes is `WooCommerceIntegrationModule`; this barrel also exports the
 * static `woocommerceAdapterManifest`, config / credentials types, and
 * domain exceptions for consumers (connection tester, sync services, etc.).
 *
 * WooCommerceHttpResponseException is intentionally NOT exported — it is a
 * transport-level implementation detail of WooCommerceHttpClient, lives in
 * infrastructure/http/, and must never escape the adapter layer.
 *
 * @module libs/integrations/woocommerce/src
 */

// Config + credentials types
export type { WooCommerceConnectionConfig } from './domain/types/woocommerce-config.types';
export type { WooCommerceOrdersConfig } from './domain/types/woocommerce-orders-config.types';
export type { WooCommerceCredentials } from './domain/types/woocommerce-credentials.types';

// Domain exceptions — 5 domain-level exceptions exported for consumers
export { WooCommerceNotSupportedException } from './domain/exceptions/woocommerce-not-supported.exception';
export { WooCommerceConfigException } from './domain/exceptions/woocommerce-config.exception';
export { WooCommerceResourceNotFoundException } from './domain/exceptions/woocommerce-resource-not-found.exception';
export { WooCommerceUnauthorizedException } from './domain/exceptions/woocommerce-unauthorized.exception';
export { WooCommerceNetworkException } from './domain/exceptions/woocommerce-network.exception';

// Plugin descriptor + static manifest (#575)
export { woocommerceAdapterManifest, createWooCommercePlugin } from './woocommerce-plugin';

// Host wiring
export { WooCommerceIntegrationModule } from './woocommerce-integration.module';
