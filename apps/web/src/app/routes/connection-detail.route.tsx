import type { RouteObject } from 'react-router-dom';
import { ConnectionDetailPage } from '../../pages/connections/connection-detail-page';

export const connectionDetailRoute: RouteObject = {
  path: 'connections/:connectionId',
  element: <ConnectionDetailPage />,
};
