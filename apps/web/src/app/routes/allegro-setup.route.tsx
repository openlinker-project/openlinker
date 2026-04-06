import type { RouteObject } from 'react-router-dom';
import { AllegroSetupPage } from '../../pages/connections/allegro-setup-page';

export const allegroSetupRoute: RouteObject = {
  path: 'connections/new/allegro',
  element: <AllegroSetupPage />,
};
