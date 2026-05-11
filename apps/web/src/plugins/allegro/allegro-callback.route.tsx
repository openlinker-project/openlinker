/**
 * Route: `/integrations/allegro/connect/callback` — OAuth2 callback landing.
 *
 * @module plugins/allegro
 */
import type { RouteObject } from 'react-router-dom';

export const allegroCallbackRoute: RouteObject = {
  path: 'integrations/allegro/connect/callback',
  lazy: async () => {
    const { AllegroConnectCallbackPage } = await import(
      '../../pages/integrations/allegro-connect-callback-page'
    );
    return { Component: AllegroConnectCallbackPage };
  },
};
