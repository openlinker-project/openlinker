/**
 * Route: `/integrations/shopify/connect/callback` - OAuth install landing.
 *
 * @module plugins/shopify
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getMessages } from '../../shared/i18n';

export const shopifyCallbackRoute: RouteObject = {
  path: 'integrations/shopify/connect/callback',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getMessages('shopify').plugin.callbackCrumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ShopifyConnectCallbackPage } = await import(
      '../../pages/integrations/shopify-connect-callback-page'
    );
    return { Component: ShopifyConnectCallbackPage };
  },
};
