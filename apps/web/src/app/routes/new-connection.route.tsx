import type { RouteObject } from 'react-router-dom';
import { NewConnectionPage } from '../../pages/connections/new-connection-page';

export const newConnectionRoute: RouteObject = {
  path: 'connections/new',
  element: <NewConnectionPage />,
};
