/**
 * Shopify plugin
 *
 * Front for the Shopify connection (#3974): the setup route (app credentials,
 * access token, or an OAuth install) and the OAuth callback route. The
 * capability-specific sections arrive with the capabilities.
 *
 * @module plugins/shopify
 */
import type { OpenLinkerPlugin } from '../../shared/plugins';
import { getMessages } from '../../shared/i18n';
import { definePlugin } from '../define-plugin';
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
        return getMessages('shopify').plugin.setupCardDescription;
      },
      to: '/connections/new/shopify',
      get badge(): string {
        return getMessages('shopify').plugin.setupCardBadge;
      },
    },
  },
});
