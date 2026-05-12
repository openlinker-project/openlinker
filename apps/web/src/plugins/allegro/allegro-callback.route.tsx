/**
 * Route: `/integrations/allegro/connect/callback` — OAuth2 callback landing.
 *
 * @module plugins/allegro
 */
import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../../app/nav-registry.types';

export const allegroCallbackRoute: RouteObject = {
  path: 'integrations/allegro/connect/callback',
  handle: { crumb: { group: 'Platform', title: 'Allegro callback' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { AllegroConnectCallbackPage } = await import(
      '../../pages/integrations/allegro-connect-callback-page'
    );
    return { Component: AllegroConnectCallbackPage };
  },
};
