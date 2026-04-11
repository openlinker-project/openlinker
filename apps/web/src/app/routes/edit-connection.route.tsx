import type { RouteObject } from 'react-router-dom';
import { EditConnectionPage } from '../../pages/connections/edit-connection-page';

export const editConnectionRoute: RouteObject = {
  path: 'connections/:connectionId/edit',
  element: <EditConnectionPage />,
};
