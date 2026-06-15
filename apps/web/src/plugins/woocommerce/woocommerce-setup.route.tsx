/**
 * Route: `/connections/new/woocommerce` — guided WooCommerce wizard.
 *
 * @module plugins/woocommerce
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const woocommerceSetupRoute: RouteObject = {
  path: 'connections/new/woocommerce',
  handle: { crumb: { group: 'Platform', title: 'Connect WooCommerce' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { WoocommerceSetupPage } = await import('../../pages/connections/woocommerce-setup-page');
    return { Component: WoocommerceSetupPage };
  },
};
