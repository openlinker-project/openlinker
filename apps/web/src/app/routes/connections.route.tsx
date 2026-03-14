import type { RouteObject } from 'react-router-dom';
import { ConnectionsListPage } from '../../pages/connections/connections-list-page';

export const connectionsRoute: RouteObject = {
  path: 'connections',
  element: <ConnectionsListPage />,
};
