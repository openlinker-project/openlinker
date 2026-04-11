import type { RouteObject } from 'react-router-dom';
import { ConnectionMappingsPage } from '../../pages/connections/connection-mappings-page';

export const connectionMappingsRoute: RouteObject = {
  path: 'connections/:connectionId/mappings',
  element: <ConnectionMappingsPage />,
};
