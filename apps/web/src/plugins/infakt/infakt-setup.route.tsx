/**
 * Route: `/connections/new/infakt` — guided inFakt wizard.
 *
 * @module plugins/infakt
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const infaktSetupRoute: RouteObject = {
  path: 'connections/new/infakt',
  handle: { crumb: { group: 'Platform', title: 'Connect inFakt' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { InfaktSetupPage } = await import('../../pages/connections/infakt-setup-page');
    return { Component: InfaktSetupPage };
  },
};
