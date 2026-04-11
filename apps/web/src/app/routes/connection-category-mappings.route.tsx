import type { RouteObject } from 'react-router-dom';
import { ConnectionCategoryMappingsPage } from '../../pages/connections/connection-category-mappings-page';

export const connectionCategoryMappingsRoute: RouteObject = {
  path: 'connections/:connectionId/mappings/categories',
  element: <ConnectionCategoryMappingsPage />,
};
