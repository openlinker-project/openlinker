/**
 * Route: `/connections/new/erli` — guided Erli wizard.
 *
 * @module plugins/erli
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const erliSetupRoute: RouteObject = {
  path: 'connections/new/erli',
  handle: { crumb: { group: 'Platform', title: 'Connect Erli' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ErliSetupPage } = await import('../../pages/connections/erli-setup-page');
    return { Component: ErliSetupPage };
  },
};
