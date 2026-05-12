/**
 * Route: `/connections/new/prestashop` — guided PrestaShop wizard.
 *
 * @module plugins/prestashop
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const prestashopSetupRoute: RouteObject = {
  path: 'connections/new/prestashop',
  handle: { crumb: { group: 'Platform', title: 'Connect PrestaShop' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { PrestashopSetupPage } = await import(
      '../../pages/connections/prestashop-setup-page'
    );
    return { Component: PrestashopSetupPage };
  },
};
