/**
 * Shopify Integration - Public API
 *
 * Barrel for `@openlinker/integrations-shopify`. PROTOTYPE for spike #3928.
 *
 * @module libs/integrations/shopify/src
 */

export {
  createShopifyPlugin,
  shopifyAdapterManifest,
  type CreateShopifyPluginDeps,
} from './shopify-plugin';

export { ShopifyIntegrationModule } from './shopify-integration.module';

export type { ShopifyConnectionConfig } from './domain/types/shopify-config.types';
export type { ShopifyCredentials } from './domain/types/shopify-credentials.types';
