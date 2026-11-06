/**
 * Route: `/connections/new/dpd` — guided DPD Polska wizard.
 *
 * @module plugins/dpd
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getDpdMessages } from './messages';

export const dpdSetupRoute: RouteObject = {
  path: 'connections/new/dpd',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getDpdMessages().dpdSetupRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { DpdSetupPage } = await import('../../pages/connections/dpd-setup-page');
    return { Component: DpdSetupPage };
  },
};
