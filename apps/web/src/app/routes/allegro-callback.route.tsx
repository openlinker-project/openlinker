import type { RouteObject } from 'react-router-dom';
import { AllegroConnectCallbackPage } from '../../pages/integrations/allegro-connect-callback-page';

export const allegroCallbackRoute: RouteObject = {
  path: 'integrations/allegro/connect/callback',
  element: <AllegroConnectCallbackPage />,
};
