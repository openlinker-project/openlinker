import type { RouteObject } from 'react-router-dom';

export const connectionsRoute: RouteObject = {
  path: 'connections',
  lazy: async () => {
    const { ConnectionsListPage } = await import(
      '../../pages/connections/connections-list-page'
    );
    return { Component: ConnectionsListPage };
  },
};
