import type { RouteObject } from 'react-router-dom';

export const cursorsRoute: RouteObject = {
  path: 'cursors',
  children: [
    {
      index: true,
      lazy: async () => {
        const { CursorsListPage } = await import('../../pages/cursors/cursors-list-page');
        return { Component: CursorsListPage };
      },
    },
  ],
};
