/**
 * Route: `/connections/new/shopify` - Shopify connection setup.
 *
 * @module plugins/shopify
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const shopifySetupRoute: RouteObject = {
  path: 'connections/new/shopify',
  handle: { crumb: { group: 'Platform', title: 'Connect Shopify' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ShopifySetupPage } = await import('../../pages/connections/shopify-setup-page');
    return { Component: ShopifySetupPage };
  },
};
