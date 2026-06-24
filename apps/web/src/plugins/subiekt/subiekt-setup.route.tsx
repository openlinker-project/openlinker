/**
 * Route: `/connections/new/subiekt` — guided Subiekt wizard (#1199).
 *
 * @module plugins/subiekt
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const subiektSetupRoute: RouteObject = {
  path: 'connections/new/subiekt',
  handle: { crumb: { group: 'Platform', title: 'Connect Subiekt' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { SubiektSetupPage } = await import('../../pages/connections/subiekt-setup-page');
    return { Component: SubiektSetupPage };
  },
};
