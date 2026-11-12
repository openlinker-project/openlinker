/**
 * Route: `/connections/new/shopify` - Shopify connection setup.
 *
 * @module plugins/shopify
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getMessages } from '../../shared/i18n';

export const shopifySetupRoute: RouteObject = {
  path: 'connections/new/shopify',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getMessages('shopify').plugin.setupCrumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ShopifySetupPage } = await import('../../pages/connections/shopify-setup-page');
    return { Component: ShopifySetupPage };
  },
};
