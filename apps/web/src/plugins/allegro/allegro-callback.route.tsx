/**
 * Route: `/integrations/allegro/connect/callback` — OAuth2 callback landing.
 *
 * @module plugins/allegro
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';
import { getAllegroMessages } from './messages';

export const allegroCallbackRoute: RouteObject = {
  path: 'integrations/allegro/connect/callback',
  // A getter so the crumb is read in the active language at render.
  handle: {
    crumb: {
      group: 'platform',
      get title(): string {
        return getAllegroMessages().allegroCallbackRoute.crumb;
      },
    },
  } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AllegroConnectCallbackPage } = await import(
      '../../pages/integrations/allegro-connect-callback-page'
    );
    return { Component: AllegroConnectCallbackPage };
  },
};
