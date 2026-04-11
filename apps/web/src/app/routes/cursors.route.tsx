import type { RouteObject } from 'react-router-dom';
import { CursorsListPage } from '../../pages/cursors/cursors-list-page';

export const cursorsRoute: RouteObject = {
  path: 'cursors',
  children: [
    { index: true, element: <CursorsListPage /> },
  ],
};
