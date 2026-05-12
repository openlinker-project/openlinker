/**
 * Route: `/connections/new/allegro` — guided Allegro wizard.
 *
 * @module plugins/allegro
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const allegroSetupRoute: RouteObject = {
  path: 'connections/new/allegro',
  handle: { crumb: { group: 'Platform', title: 'Connect Allegro' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AllegroSetupPage } = await import('../../pages/connections/allegro-setup-page');
    return { Component: AllegroSetupPage };
  },
};
