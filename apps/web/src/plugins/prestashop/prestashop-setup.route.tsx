/**
 * Route: `/connections/new/prestashop` — guided PrestaShop wizard.
 *
 * @module plugins/prestashop
 */
import type { RouteObject } from 'react-router-dom';

export const prestashopSetupRoute: RouteObject = {
  path: 'connections/new/prestashop',
  lazy: async () => {
    const { PrestashopSetupPage } = await import(
      '../../pages/connections/prestashop-setup-page'
    );
    return { Component: PrestashopSetupPage };
  },
};
