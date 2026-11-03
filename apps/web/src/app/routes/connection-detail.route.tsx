import type { RouteObject } from 'react-router-dom';
import type { RouteCrumbHandle } from '../nav-registry.types';

export const connectionDetailRoute: RouteObject = {
  path: 'connections/:connectionId',
  handle: { crumb: { group: 'platform', page: 'connection' } } satisfies RouteCrumbHandle,
  lazy: async () => {
    const { ConnectionDetailPage } = await import(
      '../../pages/connections/connection-detail-page'
    );
    return { Component: ConnectionDetailPage };
  },
};
