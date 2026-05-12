import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

const cursorsListCrumb: RouteCrumbHandle = {
  crumb: { group: 'Diagnostics', title: 'Cursors' },
};

export const cursorsRoute: RouteObject = {
  path: 'cursors',
  children: [
    {
      index: true,
      handle: cursorsListCrumb,
      lazy: async () => {
        const { CursorsListPage } = await import('../../pages/cursors/cursors-list-page');
        return { Component: CursorsListPage };
      },
    },
  ],
};
