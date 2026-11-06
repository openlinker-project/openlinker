/**
 * Route: `/integrations/shopify/connect/callback` - OAuth install landing.
 *
 * @module plugins/shopify
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const shopifyCallbackRoute: RouteObject = {
  path: 'integrations/shopify/connect/callback',
  handle: { crumb: { group: 'Platform', title: 'Shopify callback' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ShopifyConnectCallbackPage } = await import(
      '../../pages/integrations/shopify-connect-callback-page'
    );
    return { Component: ShopifyConnectCallbackPage };
  },
};
