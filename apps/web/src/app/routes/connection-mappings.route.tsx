import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const connectionMappingsRoute: RouteObject = {
  path: 'connections/:connectionId/mappings',
  handle: { crumb: { group: 'Platform', title: 'Connection' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ConnectionMappingsPage } = await import(
      '../../pages/connections/connection-mappings-page'
    );
    return { Component: ConnectionMappingsPage };
  },
};
