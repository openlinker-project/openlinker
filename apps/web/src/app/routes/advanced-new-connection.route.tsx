/**
 * Route: `/connections/new/advanced` — raw connection form fallback.
 */
import type { RouteObject } from 'react-router-dom';
import { AdvancedNewConnectionPage } from '../../pages/connections/advanced-new-connection-page';

export const advancedNewConnectionRoute: RouteObject = {
  path: 'connections/new/advanced',
  element: <AdvancedNewConnectionPage />,
};
