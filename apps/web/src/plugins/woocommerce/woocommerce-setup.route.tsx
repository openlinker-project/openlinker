/**
 * Route: `/connections/new/woocommerce` — guided WooCommerce wizard.
 *
 * @module plugins/woocommerce
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getWoocommerceMessages } from './messages';

export const woocommerceSetupRoute: RouteObject = {
  path: 'connections/new/woocommerce',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getWoocommerceMessages().woocommerceSetupRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { WoocommerceSetupPage } = await import('../../pages/connections/woocommerce-setup-page');
    return { Component: WoocommerceSetupPage };
  },
};
