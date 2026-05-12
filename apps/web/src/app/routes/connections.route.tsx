import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const connectionsRoute: RouteObject = {
  path: 'connections',
  handle: { crumb: { group: 'Platform', title: 'Connections' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ConnectionsListPage } = await import(
      '../../pages/connections/connections-list-page'
    );
    return { Component: ConnectionsListPage };
  },
};
