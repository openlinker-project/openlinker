import type { RouteObject } from 'react-router-dom';

export const newConnectionRoute: RouteObject = {
  path: 'connections/new',
  lazy: async () => {
    const { NewConnectionPage } = await import('../../pages/connections/new-connection-page');
    return { Component: NewConnectionPage };
  },
};
