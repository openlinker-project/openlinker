import type { RouteObject } from 'react-router-dom';

export const connectionCategoryMappingsRoute: RouteObject = {
  path: 'connections/:connectionId/mappings/categories',
  lazy: async () => {
    const { ConnectionCategoryMappingsPage } = await import(
      '../../pages/connections/connection-category-mappings-page'
    );
    return { Component: ConnectionCategoryMappingsPage };
  },
};
