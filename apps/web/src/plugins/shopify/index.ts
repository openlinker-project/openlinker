/**
 * Shopify plugin
 *
 * Front for the Shopify connection (#3974): the setup route (app credentials,
 * access token, or an OAuth install), the OAuth callback route, the
 * edit-connection section (callback URL, location, untracked stock, sales
 * country, refunds through Shopify) and the Configure webhooks action (#3982).
 *
 * @module plugins/shopify
 */
import { publicApiBaseUrl } from '../../shared/config/public-api-base-url';
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { definePlugin } from '../define-plugin';
import { ShopifyConnectionActions } from './components/shopify-connection-actions';
import { ShopifyStructuredSection } from './components/shopify-structured-section';
import { getShopifyMessages } from './messages';
import { shopifyConnectionConfig } from './shopify-connection-config';
import { shopifyCallbackRoute } from './shopify-callback.route';
import { shopifySetupRoute } from './shopify-setup.route';
import { createShopifyApi, type ShopifyApi } from '../../features/shopify';

declare module '../../app/api/api-client' {
  interface PluginApiNamespaces {
    shopify: ShopifyApi;
  }
}

export const shopifyPlugin: OpenLinkerPlugin = definePlugin({
  id: 'shopify',
  platformType: 'shopify',
  build: {
    routes: [shopifySetupRoute, shopifyCallbackRoute],
    apiNamespaces: (request) => ({ shopify: createShopifyApi(request) }),
  },
  platform: {
    displayName: 'Shopify',
    setupCard: {
      title: 'Shopify',
      // Getters, not values: the card is read at render, so the copy follows
      // the active language instead of freezing at module load.
      get description(): string {
        return getShopifyMessages().plugin.setupCardDescription;
      },
      to: '/connections/new/shopify',
      get badge(): string {
        return getShopifyMessages().plugin.setupCardBadge;
      },
    },
    getCallbackUrlDefault: publicApiBaseUrl,
    StructuredConfigSection: ShopifyStructuredSection,
    connectionConfig: shopifyConnectionConfig,
    ConnectionActions: ShopifyConnectionActions,
  },
});
