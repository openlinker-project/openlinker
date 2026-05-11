/**
 * Route: `/connections/new/allegro` — guided Allegro wizard.
 *
 * @module plugins/allegro
 */
import type { RouteObject } from 'react-router-dom';

export const allegroSetupRoute: RouteObject = {
  path: 'connections/new/allegro',
  lazy: async () => {
    const { AllegroSetupPage } = await import('../../pages/connections/allegro-setup-page');
    return { Component: AllegroSetupPage };
  },
};
