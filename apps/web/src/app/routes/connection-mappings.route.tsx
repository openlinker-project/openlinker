import type { RouteObject } from 'react-router-dom';

export const connectionMappingsRoute: RouteObject = {
  path: 'connections/:connectionId/mappings',
  lazy: async () => {
    const { ConnectionMappingsPage } = await import(
      '../../pages/connections/connection-mappings-page'
    );
    return { Component: ConnectionMappingsPage };
  },
};
