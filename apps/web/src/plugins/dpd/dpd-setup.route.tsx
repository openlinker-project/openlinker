/**
 * Route: `/connections/new/dpd` — guided DPD Polska wizard.
 *
 * @module plugins/dpd
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const dpdSetupRoute: RouteObject = {
  path: 'connections/new/dpd',
  handle: { crumb: { group: 'Platform', title: 'Connect DPD Polska' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { DpdSetupPage } = await import('../../pages/connections/dpd-setup-page');
    return { Component: DpdSetupPage };
  },
};
