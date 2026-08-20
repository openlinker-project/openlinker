/**
 * Route: `/connections/new/eparagony` - guided eparagony.pl wizard (#1911).
 *
 * @module plugins/eparagony
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const eparagonySetupRoute: RouteObject = {
  path: 'connections/new/eparagony',
  handle: { crumb: { group: 'Platform', title: 'Connect eparagony.pl' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { EparagonySetupPage } = await import('../../pages/connections/eparagony-setup-page');
    return { Component: EparagonySetupPage };
  },
};
