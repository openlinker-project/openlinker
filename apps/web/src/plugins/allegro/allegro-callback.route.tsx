/**
 * Route: `/integrations/allegro/connect/callback` — OAuth2 callback landing.
 *
 * @module plugins/allegro
 */
import type { RouteObject } from 'react-router-dom';

import { AllegroConnectCallbackPage } from '../../pages/integrations/allegro-connect-callback-page';

export const allegroCallbackRoute: RouteObject = {
  path: 'integrations/allegro/connect/callback',
  element: <AllegroConnectCallbackPage />,
};
