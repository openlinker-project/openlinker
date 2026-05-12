/**
 * Route: `/connections/new/advanced` — raw connection form fallback.
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const advancedNewConnectionRoute: RouteObject = {
  path: 'connections/new/advanced',
  handle: { crumb: { group: 'Platform', title: 'Advanced setup' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AdvancedNewConnectionPage } = await import(
      '../../pages/connections/advanced-new-connection-page'
    );
    return { Component: AdvancedNewConnectionPage };
  },
};
