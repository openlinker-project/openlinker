import type { RouteObject } from 'react-router-dom';

export const connectionDetailRoute: RouteObject = {
  path: 'connections/:connectionId',
  lazy: async () => {
    const { ConnectionDetailPage } = await import(
      '../../pages/connections/connection-detail-page'
    );
    return { Component: ConnectionDetailPage };
  },
};
