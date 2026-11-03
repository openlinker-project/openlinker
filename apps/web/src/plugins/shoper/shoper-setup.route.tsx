/**
 * Route: `/connections/new/shoper` — guided Shoper wizard.
 *
 * @module plugins/shoper
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const shoperSetupRoute: RouteObject = {
  path: 'connections/new/shoper',
  handle: { crumb: { group: 'Platform', title: 'Connect Shoper' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ShoperSetupPage } = await import('../../pages/connections/shoper-setup-page');
    return { Component: ShoperSetupPage };
  },
};
