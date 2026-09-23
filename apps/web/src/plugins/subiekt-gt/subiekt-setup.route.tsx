/**
 * Route: `/connections/new/subiekt-gt` — guided Subiekt GT wizard (#1199).
 *
 * @module plugins/subiekt-gt
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const subiektSetupRoute: RouteObject = {
  path: 'connections/new/subiekt-gt',
  handle: { crumb: { group: 'Platform', title: 'Connect Subiekt' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { SubiektSetupPage } = await import('../../pages/connections/subiekt-setup-page');
    return { Component: SubiektSetupPage };
  },
};
