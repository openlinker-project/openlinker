/**
 * Route: `/connections/new/allegro` — guided Allegro wizard.
 *
 * @module plugins/allegro
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getAllegroMessages } from './messages';

export const allegroSetupRoute: RouteObject = {
  path: 'connections/new/allegro',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getAllegroMessages().allegroSetupRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AllegroSetupPage } = await import('../../pages/connections/allegro-setup-page');
    return { Component: AllegroSetupPage };
  },
};
