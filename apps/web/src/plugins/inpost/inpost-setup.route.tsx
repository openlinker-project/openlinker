/**
 * Route: `/connections/new/inpost` — guided InPost (ShipX) wizard.
 *
 * @module plugins/inpost
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const inpostSetupRoute: RouteObject = {
  path: 'connections/new/inpost',
  handle: { crumb: { group: 'Platform', title: 'Connect InPost' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { InpostSetupPage } = await import('../../pages/connections/inpost-setup-page');
    return { Component: InpostSetupPage };
  },
};
