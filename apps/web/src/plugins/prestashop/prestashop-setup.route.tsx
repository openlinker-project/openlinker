/**
 * Route: `/connections/new/prestashop` — guided PrestaShop wizard.
 *
 * @module plugins/prestashop
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getPrestashopMessages } from './messages';

export const prestashopSetupRoute: RouteObject = {
  path: 'connections/new/prestashop',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getPrestashopMessages().prestashopSetupRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { PrestashopSetupPage } = await import(
      '../../pages/connections/prestashop-setup-page'
    );
    return { Component: PrestashopSetupPage };
  },
};
