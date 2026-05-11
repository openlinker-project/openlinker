/**
 * Route: `/connections/new/prestashop` — guided PrestaShop wizard.
 *
 * @module plugins/prestashop
 */
import type { RouteObject } from 'react-router-dom';

import { PrestashopSetupPage } from '../../pages/connections/prestashop-setup-page';

export const prestashopSetupRoute: RouteObject = {
  path: 'connections/new/prestashop',
  element: <PrestashopSetupPage />,
};
