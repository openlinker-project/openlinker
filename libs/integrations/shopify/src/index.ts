/**
 * Shopify Integration - Public API
 *
 * Barrel for `@openlinker/integrations-shopify`.
 *
 * @module libs/integrations/shopify/src
 */

export {
  createShopifyPlugin,
  shopifyAdapterManifest,
  type CreateShopifyPluginDeps,
} from './shopify-plugin';

export { ShopifyIntegrationModule } from './shopify-integration.module';

export {
  SHOPIFY_ADAPTER_KEY,
  SHOPIFY_PLATFORM_TYPE,
  SHOPIFY_SUPPORTED_API_VERSIONS,
  SHOPIFY_DEFAULT_API_VERSION,
} from './shopify.constants';

export { ShopifyAdapterFactory, type ShopifyResolution } from './application/shopify-adapter.factory';

export {
  checkShopifyOAuthCallback,
  type ShopifyOAuthCallbackCheck,
  type ShopifyOAuthCallbackRefusal,
} from './domain/policies/shopify-oauth-callback.policy';
export { parseShopifyConfig } from './domain/policies/shopify-config.policy';

export type { ShopifyConnectionConfig } from './domain/types/shopify-config.types';
export type { ShopifyCredentials } from './domain/types/shopify-credentials.types';
